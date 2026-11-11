// Accès aux données de Bibliorue via Supabase.
// Toutes les opérations passent par des fonctions SQL (« RPC ») définies dans
// supabase/migrations/…_bibliorue.sql : c'est la base qui vérifie les droits.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { normalizeIsbn } from './isbn.js';

export class ApiError extends Error {
  constructor(message, { code = null, existingId = null } = {}) {
    super(message);
    this.code = code;
    this.data = existingId ? { existingId } : {};
  }
}

export function isConfigured(url = SUPABASE_URL, key = SUPABASE_KEY) {
  return /^https?:\/\/[^\s]+$/.test(url) && typeof key === 'string' && key.length > 20 && !key.startsWith('COLLEZ');
}

// Traduction des messages d'erreur de Supabase Auth (en anglais) pour l'utilisateur.
const AUTH_MESSAGES = [
  [/invalid login credentials/i, 'E-mail ou mot de passe incorrect.'],
  [/email not confirmed/i, 'Confirmez d\'abord votre adresse : cliquez sur le lien reçu par e-mail à l\'inscription.'],
  [/already registered|already exists/i, 'Un compte existe déjà avec cet e-mail.'],
  [/password should be|weak.?password/i, 'Mot de passe trop faible : 8 caractères minimum.'],
  [/rate limit|too many/i, 'Trop de demandes récentes. Réessayez dans un moment (limite d\'envoi d\'e-mails).'],
  [/unable to validate email|invalid.*email/i, 'Adresse e-mail invalide.'],
  [/signups? not allowed/i, 'Les inscriptions sont fermées pour le moment.'],
  [/failed to fetch|network/i, 'Connexion impossible. Vérifiez votre accès à Internet.'],
];
function authError(err) {
  const msg = err?.message ?? String(err);
  const fr = AUTH_MESSAGES.find(([re]) => re.test(msg))?.[1];
  return new ApiError(fr ?? msg, { code: err?.code ?? null });
}

export function createApi(client, { redirectUrl = () => globalThis.location ? location.origin + location.pathname : undefined } = {}) {
  const need = () => { if (!client) throw new ApiError('Bibliorue n\'est pas encore relié à Supabase (voir js/config.js).'); };

  async function rpc(fn, args = {}) {
    need();
    const { data, error } = await client.rpc(fn, args);
    if (error) {
      if (/failed to fetch|networkerror/i.test(error.message)) throw new ApiError('Connexion impossible. Vérifiez votre accès à Internet.');
      if (error.code === '42501' && /permission denied/i.test(error.message)) throw new ApiError('Connectez-vous pour faire cela.', { code: error.code });
      const existingId = error.code === '23505' && /^\d+$/.test(error.hint ?? '') ? Number(error.hint) : null;
      throw new ApiError(error.message, { code: error.code, existingId });
    }
    return data;
  }

  return {
    client,

    // ---------- Comptes ----------
    async me() { return rpc('my_profile'); },

    async register({ email, password, displayName, accountType, venueKind, website }) {
      need();
      if (String(password ?? '').length < 8) throw new ApiError('Le mot de passe doit faire au moins 8 caractères.');
      if (!String(displayName ?? '').trim()) throw new ApiError('Le nom affiché est obligatoire.');
      const { data, error } = await client.auth.signUp({
        email: String(email ?? '').trim(), password,
        options: {
          emailRedirectTo: redirectUrl(),
          data: { display_name: displayName.trim(), account_type: accountType === 'culture' ? 'culture' : 'person', venue_kind: venueKind ?? null, website: website ?? null },
        },
      });
      if (error) throw authError(error);
      // Supabase ne révèle pas qu'un e-mail est déjà pris : il renvoie un utilisateur sans « identité ».
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new ApiError('Un compte existe déjà avec cet e-mail.');
      }
      if (!data.session) return { user: null, needsConfirmation: true };
      const { user } = await rpc('my_profile');
      return { user, needsConfirmation: false };
    },

    async login({ email, password }) {
      need();
      const { error } = await client.auth.signInWithPassword({ email: String(email ?? '').trim(), password });
      if (error) throw authError(error);
      return rpc('my_profile');
    },

    async logout() { if (client) await client.auth.signOut(); },

    async resetPassword(email) {
      need();
      const { error } = await client.auth.resetPasswordForEmail(String(email ?? '').trim(), { redirectTo: redirectUrl() });
      if (error) throw authError(error);
    },

    async updatePassword(password) {
      need();
      if (String(password ?? '').length < 8) throw new ApiError('Le mot de passe doit faire au moins 8 caractères.');
      const { error } = await client.auth.updateUser({ password });
      if (error) throw authError(error);
    },

    onAuthChange(cb) {
      if (!client) return () => {};
      // Le rappel est différé : appeler Supabase directement depuis onAuthStateChange
      // bloquerait la bibliothèque (verrou de session interne, cf. documentation supabase-js).
      const { data } = client.auth.onAuthStateChange((event, session) => { setTimeout(() => cb(event, session), 0); });
      return () => data.subscription.unsubscribe();
    },

    updateMe: (d) => rpc('update_profile', { p_display_name: d.displayName ?? null, p_venue_kind: d.venueKind ?? null, p_website: d.website ?? null }),

    // Suppression : on revérifie le mot de passe avant d'effacer le compte.
    async deleteMe(password) {
      need();
      const { data } = await client.auth.getUser();
      const email = data?.user?.email;
      if (!email) throw new ApiError('Connectez-vous pour faire cela.');
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new ApiError('Mot de passe incorrect.');
      await rpc('delete_my_account');
      await client.auth.signOut({ scope: 'local' }).catch(() => {});
      return { ok: true };
    },

    // ---------- Carte ----------
    async boxes(bbox) {
      const boxes = await rpc('get_boxes', bbox ? { p_south: +bbox.south, p_west: +bbox.west, p_north: +bbox.north, p_east: +bbox.east } : {});
      return { boxes };
    },
    box: (id) => rpc('get_box', { p_box_id: Number(id) }),
    async addBox(d) {
      const box = await rpc('add_box', {
        p_name: d.name, p_lat: Number(d.lat), p_lon: Number(d.lon), p_address: d.address ?? '', p_description: d.description ?? '',
        p_hours: d.hours ?? '', p_category: d.category === 'venue' ? 'venue' : 'street', p_osm_id: d.osmId || null,
      });
      return { box };
    },
    async updateBox(id, d) {
      const box = await rpc('update_box', { p_box_id: Number(id), p_name: d.name ?? null, p_address: d.address ?? null, p_description: d.description ?? null, p_hours: d.hours ?? null });
      return { box };
    },
    deleteBox: (id) => rpc('delete_box', { p_box_id: Number(id) }),

    // ---------- Livres ----------
    async addBook(boxId, d) {
      const book = await rpc('add_book', {
        p_box_id: Number(boxId), p_title: d.title ?? '', p_authors: d.authors ?? '', p_isbn: d.isbn ? (normalizeIsbn(d.isbn) ?? '') : '',
        p_year: d.year ?? '', p_publisher: d.publisher ?? '', p_cover_url: d.coverUrl ?? '', p_note: d.note ?? '',
      });
      return { book };
    },
    takeBook: (id) => rpc('change_book', { p_book_id: Number(id), p_action: 'take' }),
    returnBook: (id, boxId) => rpc('change_book', { p_book_id: Number(id), p_action: 'return', p_box_id: boxId == null ? null : Number(boxId) }),
    goneBook: (id) => rpc('change_book', { p_book_id: Number(id), p_action: 'gone' }),
    async search(q) { return { results: await rpc('search_books', { p_q: q }) }; },

    // ---------- Communauté, données ouvertes, modération ----------
    activity: () => rpc('community'),
    exportGeojson: () => rpc('export_geojson'),
    report: (targetType, targetId, reason) => rpc('report', { p_target_type: targetType, p_target_id: Number(targetId), p_reason: reason }),
    async reports() { return { reports: await rpc('admin_reports') }; },
    resolveReport: (id) => rpc('admin_resolve_report', { p_report_id: Number(id) }),
    backup: () => rpc('admin_backup'),
  };
}

// Client du navigateur : la bibliothèque supabase-js (vendor/) définit window.supabase.
const client = isConfigured() && globalThis.supabase?.createClient
  ? globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  : null;

export const api = createApi(client);
