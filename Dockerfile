# ribo als statische Web-App: bauen mit Node, ausliefern mit nginx
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages ./packages
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build-only

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
