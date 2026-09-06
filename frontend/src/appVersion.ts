/** Short git SHA/build number baked in at build time (see Dockerfile/docker-publish.yml) - "dev" outside Docker. */
export const APP_VERSION = import.meta.env.VITE_APP_VERSION || "dev";
