import * as stream from 'stream';
import archiver from 'archiver';
import { Transcripts } from '../../worker/src/transcribe';
import { promisify } from 'util';

export const getZipBlob = async (files: Transcripts) => {
	// Create an archive stream and buffer
	const archive = archiver('zip', { zlib: { level: 9 } });
	const bufferStream = new stream.PassThrough();
	const chunks: Uint8Array[] = [];

	// Listen for 'data' events to collect chunks of the zip file
	bufferStream.on('data', (chunk) => chunks.push(chunk));

	// Pipe the archive data to the buffer stream
	archive.pipe(bufferStream);

	// Add files to the archive
	archive.append(files.srt, { name: 'transcript.srt' });
	archive.append(files.text, { name: 'transcript.txt' });
	archive.append(files.json, { name: 'transcript.json' });

	// Finalize the archive (ensures all files are added)
	archive.finalize();

	// Wait for the archive to complete and concatenate chunks into a Blob
	await promisify(stream.finished)(bufferStream); // Ensure the stream finishes
	const zipBlob = new Blob(chunks, { type: 'application/zip' });

	return zipBlob;
};
