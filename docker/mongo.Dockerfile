# Bake the init scripts into the image so we don't rely on a runtime bind mount.
# On Docker Desktop for Windows, host bind mounts of E:\ don't reliably propagate
# into containers, but build-context COPY does. Scripts in /docker-entrypoint-initdb.d
# still run only on first boot (empty data volume).
FROM mongo:7
COPY mongo-init/ /docker-entrypoint-initdb.d/
