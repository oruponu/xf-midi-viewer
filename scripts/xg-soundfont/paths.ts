import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');

export const SOURCE_SOUND_BANK_PATH = join(ROOT, 'assets', 'soundfonts', 'GeneralUser-GS.sf3');
export const OUTPUT_SOUND_BANK_PATH = join(ROOT, 'public', 'soundfonts', 'GeneralUser-GS-XG.sf3');
