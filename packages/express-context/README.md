# @constructive-io/express-context

Extractable Express middleware for Constructive tenant context — domain resolution, JWT auth, pgSettings, and withPgClient.

## Usage

```typescript
import {
  createContextMiddleware,
  requestIdMiddleware
} from '@constructive-io/express-context';

const app = express();

app.use(requestIdMiddleware());
app.use(apiMiddleware);            // sets req.api
app.use(authMiddleware);           // sets req.token
app.use(createContextMiddleware()); // builds req.constructive

app.post('/v1/chat', async (req, res) => {
  const { withPgClient, pgSettings, userId, databaseId } = req.constructive;

  const result = await withPgClient(async (client) => {
    return client.query('SELECT current_user_id()');
  });

  res.json(result.rows);
});
```

## What it provides

- **Types** — `ApiStructure`, `RlsModule`, `AuthSettings`, `ConstructiveContext`, etc.
- **pgSettings builder** — Constructs SET LOCAL key-value pairs from API + token
- **withPgClient** — Tenant-scoped RLS transaction helper (BEGIN → SET LOCAL → fn → COMMIT)
- **requestId middleware** — UUID correlation ID (from X-Request-Id header or generated)
- **Context middleware** — Composes all of the above into `req.constructive`
