# Deployment

Build the web app with `npm run build` and run `npm start` behind an HTTPS reverse proxy. Use managed PostgreSQL and Appwrite Cloud private storage. Docker is optional. Redis and a worker are optional until queue scale requires them. Store Appwrite, database, AI, and session secrets in a managed secret store, not `.env` files in the image.

Recommended rollout: web/API container, managed PostgreSQL, Appwrite private bucket, and centralized structured logs. Add a worker container for persisted AI processing and notifications when needed. Migrations run as a controlled release step. Health checks use `/api/health`; readiness should additionally verify database connectivity and Appwrite configuration in the deployment platform.
