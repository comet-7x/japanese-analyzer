import data from '../data/daily-sentences.json';
import { parseSentencePack } from './sentencePack';

export const bundledSentencePack = parseSentencePack(data);
