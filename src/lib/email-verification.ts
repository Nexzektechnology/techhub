import { z } from 'zod';
import {verificationNext} from './workspace-path';

export const emailVerification = z.object({
  token_hash: z.string().min(20).max(2000).regex(/^[A-Za-z0-9_-]+$/),
  type: z.enum(['email', 'signup', 'recovery','invite']),
  next:z.string().refine(v=>v==='/account'||v==='/reset-password'||!!verificationNext(v)).catch('/account'),
});
