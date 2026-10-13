# The pilotkit desk in a container. "pilotkit container up" builds it from the package it ships in;
# from a clone of the repo: docker compose -f docker/compose.yaml up -d --build
FROM node:22-bookworm-slim

# The Copilot CLI signs the container in to Copilot: "copilot login", which pilotkit setup runs.
ARG COPILOT_CLI_VERSION=1.0.96

ENV NODE_ENV=production \
    PILOTKIT_CONTAINER=1 \
    PILOTKIT_HOME=/home/node/.pilotkit \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

WORKDIR /opt/pilotkit
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit \
 && npm install -g --no-audit "@github/copilot@${COPILOT_CLI_VERSION}" \
 && npm cache clean --force
COPY bin ./bin
COPY src ./src
COPY site ./site
COPY examples ./examples
RUN chmod 755 bin/pilotkit.mjs && ln -s /opt/pilotkit/bin/pilotkit.mjs /usr/local/bin/pilotkit

# Everything the desk keeps (settings, history, the Atlassian token, the Copilot login) lives in
# /home/node, which compose mounts as a volume. The rest of the filesystem is read-only.
USER node
WORKDIR /home/node
EXPOSE 8717
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PILOTKIT_PORT || 8717) + '/api/state').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["pilotkit", "start", "--no-open"]
