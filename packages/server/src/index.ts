import { DEFAULT_PORT } from '@wst/engine';
import { startServer } from './server';

startServer(Number(process.env.PORT ?? DEFAULT_PORT));
