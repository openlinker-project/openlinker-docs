# syntax=docker/dockerfile:1
# Build the OpenLinker docs site (Astro 5 + Starlight → static HTML) and serve
# it with nginx. The build stage runs scripts/sync-docs.mjs, which fetches the
# allowlisted docs from the product repo over the network — so `docker build`
# needs outbound access to raw.githubusercontent.com.

FROM node:20-alpine AS base
# libc6-compat helps sharp's prebuilt binaries run on Alpine (musl); sharp is
# used at build time for Starlight's image optimization.
RUN apk add --no-cache libc6-compat
RUN corepack enable
WORKDIR /app

# ---- Dependencies ----
FROM base AS deps
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# ---- Build (sync + astro build → /app/dist) ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Canonical site URL baked into sitemap / canonical / OG tags.
ARG SITE_URL="https://docs.openlinker.io"
ENV SITE_URL=$SITE_URL
# Product ref the docs are pulled from (override to preview against a branch).
ARG DOCS_SOURCE_REF="main"
ENV DOCS_SOURCE_REF=$DOCS_SOURCE_REF
# Google Analytics 4 measurement ID — this is a static build (nginx serves
# the output with no Node process at runtime), so unlike the SSR marketing
# site this MUST be baked in at build time or GA never renders. Empty by
# default (GA off) until the property exists.
ARG PUBLIC_GA_MEASUREMENT_ID=""
ENV PUBLIC_GA_MEASUREMENT_ID=$PUBLIC_GA_MEASUREMENT_ID
RUN pnpm build

# ---- Runtime (static, nginx) ----
FROM nginx:1.27-alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1
