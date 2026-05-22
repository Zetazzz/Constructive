// Re-export the shared ConstructiveAPIToken type for backwards compatibility.
// The Express Request augmentation now lives in @constructive-io/express-context.
export type { ConstructiveAPIToken } from '@constructive-io/express-context';

// Side-effect import: pull in the Express namespace augmentation from express-context.
// This ensures `req.api`, `req.token`, `req.constructive`, etc. are available.
import '@constructive-io/express-context';
