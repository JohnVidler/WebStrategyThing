import { programFromText } from '../src';

/** Program text (the TypeScript subset) in stored form, for tests that install programs by hand. */
export const prog = (text: string): string => programFromText('test', text);
