import * as fs from 'fs';

export const readFile = (filePath: string): string => {
	const file = fs.readFileSync(filePath, 'utf8');
	return file;
};
