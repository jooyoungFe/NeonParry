FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --chown=node:node backend/package.json backend/server.cjs backend/rooms.cjs backend/matchmaking.cjs ./backend/
COPY --chown=node:node frontend/ ./frontend/
COPY --chown=node:node scripts/dev_duel.cjs scripts/serve.cjs ./scripts/
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "scripts/serve.cjs"]
