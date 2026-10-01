# Deployment

Build the web app with `npm run build` and run `npm start` behind an HTTPS reverse proxy. Use managed PostgreSQL, Redis, and private S3-compatible storage. Store secrets in a managed secret store, not `.env` files on the image.

Recommended rollout: web/API container, worker container for processing/conversion/notifications, managed database, private object storage, and centralized structured logs. Migrations run as a controlled release step. Health checks use `/api/health`; readiness should additionally verify database connectivity in the deployment platform.
