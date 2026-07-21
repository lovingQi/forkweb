import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REPLAY_SERVER_DIR = path.resolve(__dirname, '..');
export const CACHE_DIR = path.join(REPLAY_SERVER_DIR, '.cache');
export const CONFIG_DIR = path.join(REPLAY_SERVER_DIR, 'config');
