# syntax=docker/dockerfile:1
# ASSETOWN API — image de production (amd64 / arm64)
# Construite depuis la racine du dépôt :
#   docker build -f deploy/Dockerfile -t assetown-api .

FROM node:24-bookworm-slim AS build
WORKDIR /app

# Toutes les `package.json` des workspaces sont nécessaires pour valider le
# lockfile, mais seuls les paquets partagé + backend sont réellement installés.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/launcher/package.json apps/launcher/
COPY apps/admin/package.json apps/admin/

RUN npm ci --workspace @assetown/shared --workspace @assetown/backend --ignore-scripts --no-audit --no-fund

COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY apps/backend/tsconfig.json apps/backend/
COPY apps/backend/src apps/backend/src

RUN npm run build -w @assetown/shared && npm run build -w @assetown/backend


FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4200 \
    ASSETOWN_DATA_DIR=/data

WORKDIR /app

# node_modules contient le lien @assetown/shared → ../../packages/shared :
# l'arborescence des workspaces doit être conservée à l'identique.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=build /app/apps/backend/dist ./apps/backend/dist

RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]

WORKDIR /app/apps/backend
EXPOSE 4200
CMD ["node", "dist/index.js"]
