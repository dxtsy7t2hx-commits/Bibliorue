# Image de production de Bibliorue (serveur + interface), sans dépendance npm.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY js ./js
COPY css ./css
COPY icons ./icons
COPY index.html sw.js manifest.webmanifest ./
ENV NODE_ENV=production PORT=8080 DATABASE_PATH=/data/bibliorue.db TRUST_PROXY=1
VOLUME ["/data"]
EXPOSE 8080
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
