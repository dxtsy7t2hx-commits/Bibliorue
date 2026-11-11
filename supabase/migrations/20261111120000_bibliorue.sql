-- =============================================================================
--  BIBLIORUE — script d'installation Supabase
--  À coller en entier dans Supabase : SQL Editor → New query → Run.
--  Il peut être relancé sans danger (il ne supprime aucune donnée).
--
--  Organisation :
--   1. Tables (profils, boîtes, livres, événements, signalements)
--   2. Sécurité au niveau des lignes (RLS) : tout le monde lit, personne n'écrit
--      directement ; toutes les écritures passent par les fonctions ci-dessous,
--      qui vérifient l'identité (auth.uid()) et les droits.
--   3. Création automatique du profil à l'inscription
--   4. Fonctions appelées par l'application (lecture publique / écriture membre)
--   5. Fonctions de modération
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 80),
  account_type  text not null default 'person' check (account_type in ('person', 'culture')),
  venue_kind    text check (venue_kind in ('bibliotheque','mediatheque','librairie','cafe','association','centre_culturel','ecole','autre')),
  website       text check (website is null or website ~ '^https?://'),
  role          text not null default 'member' check (role in ('member', 'admin')),
  created_at    timestamptz not null default now()
);

-- « Boîtes » : bibliothèques de rue (street) et lieux culturels (venue).
create table if not exists public.boxes (
  id          bigint generated always as identity primary key,
  category    text not null check (category in ('street', 'venue')),
  name        text not null check (char_length(name) between 1 and 120),
  lat         double precision not null check (lat between -90 and 90),
  lon         double precision not null check (lon between -180 and 180),
  address     text not null default '' check (char_length(address) <= 200),
  description text not null default '' check (char_length(description) <= 1000),
  hours       text not null default '' check (char_length(hours) <= 200),
  osm_id      text unique check (osm_id is null or osm_id ~ '^(node|way|relation)/[0-9]+$'),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists boxes_geo on public.boxes (lat, lon);

create table if not exists public.books (
  id          bigint generated always as identity primary key,
  box_id      bigint not null references public.boxes (id) on delete cascade,
  status      text not null default 'available' check (status in ('available', 'taken', 'gone')),
  title       text not null check (char_length(title) between 1 and 200),
  authors     text not null default '' check (char_length(authors) <= 200),
  isbn        text not null default '' check (isbn = '' or isbn ~ '^[0-9]{13}$'),
  year        text not null default '' check (char_length(year) <= 30),
  publisher   text not null default '' check (char_length(publisher) <= 200),
  cover_url   text not null default '' check (cover_url = '' or cover_url ~ '^https://'),
  note        text not null default '' check (char_length(note) <= 300),
  added_by    uuid references public.profiles (id) on delete set null,
  added_at    timestamptz not null default now(),
  changed_at  timestamptz not null default now()
);
create index if not exists books_box on public.books (box_id, status);

create table if not exists public.events (
  id       bigint generated always as identity primary key,
  type     text not null,
  at       timestamptz not null default now(),
  user_id  uuid references public.profiles (id) on delete set null,
  box_id   bigint,
  book_id  bigint,
  title    text not null default ''
);
create index if not exists events_at on public.events (at desc);
create index if not exists events_user_at on public.events (user_id, at desc);

create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  target_type text not null check (target_type in ('box', 'book')),
  target_id   bigint not null,
  reason      text not null check (char_length(reason) between 1 and 500),
  user_id     uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  resolved    boolean not null default false
);

-- ---------------------------------------------------------------------------
-- 2. SÉCURITÉ AU NIVEAU DES LIGNES (Row Level Security)
--    Lecture publique des données de la carte ; aucune écriture directe.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.boxes    enable row level security;
alter table public.books    enable row level security;
alter table public.events   enable row level security;
alter table public.reports  enable row level security;

drop policy if exists "lecture publique" on public.profiles;
create policy "lecture publique" on public.profiles for select to anon, authenticated using (true);
drop policy if exists "lecture publique" on public.boxes;
create policy "lecture publique" on public.boxes for select to anon, authenticated using (true);
drop policy if exists "lecture publique" on public.books;
create policy "lecture publique" on public.books for select to anon, authenticated using (true);
drop policy if exists "lecture publique" on public.events;
create policy "lecture publique" on public.events for select to anon, authenticated using (true);
-- reports : aucune politique → illisible et non modifiable sauf via les fonctions de modération.

-- Ceinture et bretelles : on retire aussi les droits d'écriture directs.
revoke insert, update, delete, truncate on public.profiles, public.boxes, public.books, public.events, public.reports from anon, authenticated;
revoke select on public.reports from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. CRÉATION AUTOMATIQUE DU PROFIL À L'INSCRIPTION
--    Les informations saisies dans le formulaire arrivent dans raw_user_meta_data.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta  jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  atype text  := case when meta->>'account_type' = 'culture' then 'culture' else 'person' end;
  vkind text  := meta->>'venue_kind';
  site  text  := nullif(trim(coalesce(meta->>'website', '')), '');
  dname text  := left(trim(coalesce(meta->>'display_name', '')), 80);
begin
  if dname = '' then dname := split_part(coalesce(new.email, 'membre'), '@', 1); end if;
  if atype = 'culture' then
    if vkind is null or vkind not in ('bibliotheque','mediatheque','librairie','cafe','association','centre_culturel','ecole','autre') then
      vkind := 'autre';
    end if;
    if site is not null and site !~* '^https?://' then site := 'https://' || site; end if;
    if site is not null and (char_length(site) > 300 or site ~ '\s') then site := null; end if;
  else
    vkind := null; site := null;
  end if;
  insert into public.profiles (id, display_name, account_type, venue_kind, website)
  values (new.id, dname, atype, vkind, site)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 4. FONCTIONS UTILITAIRES (internes)
-- ---------------------------------------------------------------------------

-- Distance « à vol d'oiseau » en mètres (formule de haversine, rayon terrestre 6 371 km).
create or replace function public.distance_m(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision
language sql immutable
set search_path = ''
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)));
$$;

-- Membre connecté, sinon erreur. Vérifie aussi la limite d'actions (60 par minute).
create or replace function public.require_member()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Connectez-vous pour faire cela.' using errcode = '28000';
  end if;
  select * into me from public.profiles where id = auth.uid();
  if not found then
    raise exception 'Profil introuvable.' using errcode = '28000';
  end if;
  if (select count(*) from public.events where user_id = me.id and at > now() - interval '1 minute') >= 60 then
    raise exception 'Trop d''actions en peu de temps, patientez un peu.' using errcode = 'P0001';
  end if;
  return me;
end;
$$;

create or replace function public.log_event(p_type text, p_user uuid, p_box bigint, p_book bigint, p_title text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.events (type, user_id, box_id, book_id, title) values (p_type, p_user, p_box, p_book, coalesce(p_title, ''));
$$;

-- Représentation JSON d'une boîte, telle que l'application l'attend.
create or replace function public.box_json(b public.boxes)
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id, 'category', b.category, 'name', b.name, 'lat', b.lat, 'lon', b.lon,
    'address', b.address, 'description', b.description, 'hours', b.hours, 'osmId', b.osm_id,
    'createdAt', b.created_at, 'updatedAt', b.updated_at,
    'bookCount', (select count(*) from public.books k where k.box_id = b.id and k.status = 'available'),
    'createdBy', (select jsonb_build_object('id', p.id, 'displayName', p.display_name, 'accountType', p.account_type,
                                            'venueKind', p.venue_kind, 'website', p.website)
                  from public.profiles p where p.id = b.created_by));
$$;

create or replace function public.book_json(k public.books)
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', k.id, 'boxId', k.box_id, 'status', k.status, 'title', k.title, 'authors', k.authors, 'isbn', k.isbn,
    'year', k.year, 'publisher', k.publisher, 'coverUrl', k.cover_url, 'note', k.note,
    'addedAt', k.added_at, 'changedAt', k.changed_at,
    'addedBy', (select jsonb_build_object('id', p.id, 'displayName', p.display_name) from public.profiles p where p.id = k.added_by));
$$;

-- ---------------------------------------------------------------------------
-- 5. LECTURE PUBLIQUE (visiteurs et membres)
-- ---------------------------------------------------------------------------

-- Boîtes dans un rectangle géographique (ou toutes, plafonné, si aucun rectangle).
create or replace function public.get_boxes(p_south double precision default null, p_west double precision default null,
                                            p_north double precision default null, p_east double precision default null)
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.box_json(b)), '[]'::jsonb)
  from public.boxes b
  where b.id in (select id from public.boxes
                 where p_south is null or p_west is null or p_north is null or p_east is null
                    or (lat between p_south and p_north and lon between p_west and p_east)
                 limit 2000);
$$;

create or replace function public.get_box(p_box_id bigint)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  b public.boxes;
begin
  select * into b from public.boxes where id = p_box_id;
  if not found then raise exception 'Boîte introuvable.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'box', public.box_json(b),
    'books', coalesce((select jsonb_agg(public.book_json(k) order by k.changed_at desc)
                       from public.books k
                       where k.id in (select id from public.books where box_id = b.id and status <> 'gone'
                                      order by changed_at desc limit 300)), '[]'::jsonb));
end;
$$;

-- Recherche d'un livre disponible (titre, auteur, ISBN), insensible à la casse.
create or replace function public.search_books(p_q text)
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  with q as (select '%' || replace(replace(replace(left(trim(coalesce(p_q, '')), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
                    char_length(trim(coalesce(p_q, ''))) as len)
  select coalesce(jsonb_agg(public.book_json(k) || jsonb_build_object('box',
           jsonb_build_object('id', b.id, 'name', b.name, 'lat', b.lat, 'lon', b.lon, 'category', b.category))), '[]'::jsonb)
  from q, public.books k
  join public.boxes b on b.id = k.box_id
  where k.id in (select id from public.books
                 where q.len >= 2 and status = 'available'
                   and (title ilike q.pat or authors ilike q.pat or isbn ilike q.pat)
                 order by changed_at desc limit 100);
$$;

-- Statistiques et fil des dernières contributions.
create or replace function public.community()
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'stats', jsonb_build_object(
      'street',  (select count(*) from public.boxes where category = 'street'),
      'venues',  (select count(*) from public.boxes where category = 'venue'),
      'books',   (select count(*) from public.books where status = 'available'),
      'members', (select count(*) from public.profiles)),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'type', e.type, 'at', e.at, 'boxId', e.box_id, 'boxName', b.name, 'title', e.title,
               'user', case when p.id is null then null
                            else jsonb_build_object('displayName', p.display_name, 'accountType', p.account_type) end)
             order by e.at desc, e.id desc)
      from (select * from public.events order by at desc, id desc limit 50) e
      left join public.profiles p on p.id = e.user_id
      left join public.boxes b on b.id = e.box_id), '[]'::jsonb));
$$;

-- Carte complète au format GeoJSON (données ouvertes, sans aucune donnée personnelle).
create or replace function public.export_geojson()
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(jsonb_build_object(
    'type', 'Feature',
    'geometry', jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(b.lon, b.lat)),
    'properties', jsonb_build_object('id', b.id, 'category', b.category, 'name', b.name, 'address', b.address,
      'description', b.description, 'hours', b.hours, 'osm_id', b.osm_id,
      'books_available', (select count(*) from public.books k where k.box_id = b.id and k.status = 'available'))
  )), '[]'::jsonb))
  from public.boxes b;
$$;

-- ---------------------------------------------------------------------------
-- 6. COMPTE DU MEMBRE CONNECTÉ
-- ---------------------------------------------------------------------------
create or replace function public.my_profile()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  p public.profiles;
begin
  if auth.uid() is null then return jsonb_build_object('user', null); end if;
  select * into p from public.profiles where id = auth.uid();
  if not found then return jsonb_build_object('user', null); end if;
  return jsonb_build_object(
    'user', jsonb_build_object('id', p.id, 'displayName', p.display_name, 'accountType', p.account_type,
      'venueKind', p.venue_kind, 'website', p.website, 'role', p.role, 'createdAt', p.created_at,
      'email', (select email from auth.users where id = p.id)),
    'contributions', jsonb_build_object(
      'boxes', (select count(*) from public.boxes where created_by = p.id),
      'books', (select count(*) from public.books where added_by = p.id)));
end;
$$;

create or replace function public.update_profile(p_display_name text default null, p_venue_kind text default null, p_website text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := public.require_member();
  site text := nullif(trim(coalesce(p_website, '')), '');
begin
  if p_display_name is not null and trim(p_display_name) = '' then
    raise exception 'Le nom affiché est obligatoire.' using errcode = '22023';
  end if;
  if site is not null and site !~* '^https?://' then site := 'https://' || site; end if;
  update public.profiles set
    display_name = coalesce(nullif(left(trim(p_display_name), 80), ''), display_name),
    venue_kind   = case when account_type = 'culture' and p_venue_kind in ('bibliotheque','mediatheque','librairie','cafe','association','centre_culturel','ecole','autre')
                        then p_venue_kind else venue_kind end,
    website      = case when account_type = 'culture' and p_website is not null then site else website end
  where id = me.id;
  return public.my_profile();
end;
$$;

-- Droit à l'effacement (RGPD, art. 17) : supprime le compte ; les boîtes et livres
-- ajoutés restent sur la carte commune, sans nom d'auteur.
create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Connectez-vous pour faire cela.' using errcode = '28000'; end if;
  delete from auth.users where id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. CONTRIBUTIONS (membres connectés)
-- ---------------------------------------------------------------------------
create or replace function public.add_box(p_name text, p_lat double precision, p_lon double precision,
                                          p_address text default '', p_description text default '', p_hours text default '',
                                          p_category text default 'street', p_osm_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me  public.profiles := public.require_member();
  cat text := case when p_category = 'venue' then 'venue' else 'street' end;
  dup record;
  b   public.boxes;
begin
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'Coordonnées invalides.' using errcode = '22023';
  end if;
  if trim(coalesce(p_name, '')) = '' then
    raise exception 'Le nom est obligatoire.' using errcode = '22023';
  end if;
  if cat = 'venue' and me.account_type <> 'culture' and me.role <> 'admin' then
    raise exception 'Seuls les comptes « lieu culturel » peuvent ajouter un lieu culturel.' using errcode = '42501';
  end if;
  if p_osm_id is not null then
    select id, name into dup from public.boxes where osm_id = p_osm_id;
    if found then
      raise exception 'Cette boîte est déjà sur la carte.' using errcode = '23505', hint = dup.id::text;
    end if;
  end if;
  -- Doublon : une boîte existe déjà à moins de 15 m (présélection rapide ≈ 55 m, puis distance exacte).
  select id, name into dup from public.boxes
  where lat between p_lat - 0.0005 and p_lat + 0.0005
    and lon between p_lon - 0.0005 and p_lon + 0.0005
    and public.distance_m(p_lat, p_lon, lat, lon) < 15
  limit 1;
  if found then
    raise exception 'Une boîte existe déjà à moins de 15 m : « % ».', dup.name using errcode = '23505', hint = dup.id::text;
  end if;
  insert into public.boxes (category, name, lat, lon, address, description, hours, osm_id, created_by)
  values (cat, left(trim(p_name), 120), p_lat, p_lon, left(trim(coalesce(p_address, '')), 200),
          left(trim(coalesce(p_description, '')), 1000), left(trim(coalesce(p_hours, '')), 200), p_osm_id, me.id)
  returning * into b;
  perform public.log_event('box_added', me.id, b.id, null, b.name);
  return public.box_json(b);
end;
$$;

create or replace function public.update_box(p_box_id bigint, p_name text default null, p_address text default null,
                                             p_description text default null, p_hours text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := public.require_member();
  b  public.boxes;
begin
  select * into b from public.boxes where id = p_box_id;
  if not found then raise exception 'Boîte introuvable.' using errcode = 'P0002'; end if;
  if b.created_by is distinct from me.id and me.role <> 'admin' then
    raise exception 'Seul l''auteur de la boîte ou un modérateur peut la modifier.' using errcode = '42501';
  end if;
  if p_name is not null and trim(p_name) = '' then
    raise exception 'Le nom est obligatoire.' using errcode = '22023';
  end if;
  update public.boxes set
    name        = coalesce(left(trim(p_name), 120), name),
    address     = coalesce(left(trim(p_address), 200), address),
    description = coalesce(left(trim(p_description), 1000), description),
    hours       = coalesce(left(trim(p_hours), 200), hours),
    updated_at  = now()
  where id = b.id
  returning * into b;
  return public.box_json(b);
end;
$$;

create or replace function public.delete_box(p_box_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := public.require_member();
  b  public.boxes;
begin
  select * into b from public.boxes where id = p_box_id;
  if not found then raise exception 'Boîte introuvable.' using errcode = 'P0002'; end if;
  if b.created_by is distinct from me.id and me.role <> 'admin' then
    raise exception 'Seul l''auteur de la boîte ou un modérateur peut la supprimer.' using errcode = '42501';
  end if;
  delete from public.boxes where id = b.id;
  perform public.log_event('box_removed', me.id, b.id, null, b.name);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.add_book(p_box_id bigint, p_title text, p_authors text default '', p_isbn text default '',
                                           p_year text default '', p_publisher text default '', p_cover_url text default '',
                                           p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := public.require_member();
  k  public.books;
begin
  if not exists (select 1 from public.boxes where id = p_box_id) then
    raise exception 'Boîte introuvable.' using errcode = 'P0002';
  end if;
  if trim(coalesce(p_title, '')) = '' then
    raise exception 'Le titre est obligatoire.' using errcode = '22023';
  end if;
  insert into public.books (box_id, title, authors, isbn, year, publisher, cover_url, note, added_by)
  values (p_box_id, left(trim(p_title), 200), left(trim(coalesce(p_authors, '')), 200),
          case when coalesce(p_isbn, '') ~ '^[0-9]{13}$' then p_isbn else '' end,
          left(trim(coalesce(p_year, '')), 30), left(trim(coalesce(p_publisher, '')), 200),
          case when coalesce(p_cover_url, '') ~ '^https://[^\s"<>]+$' and char_length(p_cover_url) <= 400 then p_cover_url else '' end,
          left(trim(coalesce(p_note, '')), 300), me.id)
  returning * into k;
  perform public.log_event('book_deposited', me.id, k.box_id, k.id, k.title);
  return public.book_json(k);
end;
$$;

-- Changement d'état d'un livre : 'take' (je le prends), 'return' (je le redépose), 'gone' (n'y est plus).
create or replace function public.change_book(p_book_id bigint, p_action text, p_box_id bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     public.profiles := public.require_member();
  k      public.books;
  target bigint;
begin
  select * into k from public.books where id = p_book_id for update;
  if not found then raise exception 'Livre introuvable.' using errcode = 'P0002'; end if;
  target := k.box_id;
  if p_action = 'take' then
    if k.status <> 'available' then raise exception 'Ce livre a déjà changé d''état. Rechargez la fiche.' using errcode = '40001'; end if;
    update public.books set status = 'taken', changed_at = now() where id = k.id returning * into k;
    perform public.log_event('book_taken', me.id, k.box_id, k.id, k.title);
  elsif p_action = 'gone' then
    if k.status <> 'available' then raise exception 'Ce livre a déjà changé d''état. Rechargez la fiche.' using errcode = '40001'; end if;
    update public.books set status = 'gone', changed_at = now() where id = k.id returning * into k;
    perform public.log_event('book_gone', me.id, k.box_id, k.id, k.title);
  elsif p_action = 'return' then
    if k.status = 'available' then raise exception 'Ce livre a déjà changé d''état. Rechargez la fiche.' using errcode = '40001'; end if;
    if p_box_id is not null then
      if not exists (select 1 from public.boxes where id = p_box_id) then
        raise exception 'Boîte introuvable.' using errcode = 'P0002';
      end if;
      target := p_box_id;
    end if;
    update public.books set status = 'available', box_id = target, changed_at = now() where id = k.id returning * into k;
    perform public.log_event('book_deposited', me.id, k.box_id, k.id, k.title);
  else
    raise exception 'Action inconnue.' using errcode = '22023';
  end if;
  return public.book_json(k);
end;
$$;

create or replace function public.report(p_target_type text, p_target_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := public.require_member();
  t  text := case when p_target_type = 'book' then 'book' else 'box' end;
begin
  if trim(coalesce(p_reason, '')) = '' then raise exception 'Le motif est obligatoire.' using errcode = '22023'; end if;
  if t = 'box' and not exists (select 1 from public.boxes where id = p_target_id)
     or t = 'book' and not exists (select 1 from public.books where id = p_target_id) then
    raise exception 'Élément introuvable.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.reports where user_id = me.id and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Trop de signalements en peu de temps.' using errcode = 'P0001';
  end if;
  insert into public.reports (target_type, target_id, reason, user_id) values (t, p_target_id, left(trim(p_reason), 500), me.id);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. MODÉRATION
-- ---------------------------------------------------------------------------
create or replace function public.admin_reports()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Réservé aux modérateurs.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'targetType', r.target_type, 'targetId', r.target_id,
                                        'reason', r.reason, 'reporter', p.display_name, 'createdAt', r.created_at)
           order by r.created_at desc)
    from (select * from public.reports where not resolved order by created_at desc limit 200) r
    left join public.profiles p on p.id = r.user_id), '[]'::jsonb);
end;
$$;

create or replace function public.admin_resolve_report(p_report_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Réservé aux modérateurs.' using errcode = '42501';
  end if;
  update public.reports set resolved = true where id = p_report_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Sauvegarde complète (pour les modérateurs) : toutes les tables, sans les e-mails ni mots de passe.
create or replace function public.admin_backup()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Réservé aux modérateurs.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'app', 'Bibliorue', 'format', 1, 'exported_at', now(),
    'profiles', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from public.profiles p), '[]'::jsonb),
    'boxes',    coalesce((select jsonb_agg(to_jsonb(b) order by b.id) from public.boxes b), '[]'::jsonb),
    'books',    coalesce((select jsonb_agg(to_jsonb(k) order by k.id) from public.books k), '[]'::jsonb),
    'events',   coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.events e), '[]'::jsonb),
    'reports',  coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.reports r), '[]'::jsonb));
end;
$$;

-- Nommer un modérateur : à lancer vous-même dans le SQL Editor, après l'inscription
--   select public.make_admin('votre.adresse@exemple.fr');
create or replace function public.make_admin(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then return 'Aucun compte avec cet e-mail. Inscrivez-vous d''abord dans l''application.'; end if;
  update public.profiles set role = 'admin' where id = uid;
  return 'OK : ' || p_email || ' est maintenant modérateur.';
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. DROITS D'EXÉCUTION
--    Par défaut, PostgreSQL autorise tout le monde à exécuter une fonction :
--    on retire ce droit, puis on l'accorde précisément.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.get_boxes(double precision, double precision, double precision, double precision) to anon, authenticated;
grant execute on function public.get_box(bigint)        to anon, authenticated;
grant execute on function public.search_books(text)     to anon, authenticated;
grant execute on function public.community()            to anon, authenticated;
grant execute on function public.export_geojson()       to anon, authenticated;
grant execute on function public.my_profile()           to anon, authenticated;

grant execute on function public.update_profile(text, text, text) to authenticated;
grant execute on function public.delete_my_account()    to authenticated;
grant execute on function public.add_box(text, double precision, double precision, text, text, text, text, text) to authenticated;
grant execute on function public.update_box(bigint, text, text, text, text) to authenticated;
grant execute on function public.delete_box(bigint)     to authenticated;
grant execute on function public.add_book(bigint, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.change_book(bigint, text, bigint) to authenticated;
grant execute on function public.report(text, bigint, text) to authenticated;
grant execute on function public.admin_reports()        to authenticated;
grant execute on function public.admin_resolve_report(bigint) to authenticated;
grant execute on function public.admin_backup()         to authenticated;
-- make_admin, handle_new_user, require_member, log_event, box_json, book_json, distance_m :
-- non exposées (utilisables seulement depuis le SQL Editor ou par les autres fonctions).

-- Fin. Vous devez voir « Success. No rows returned ».
