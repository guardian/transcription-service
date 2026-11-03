import express from 'express';

// Media uploads go directly to S3; API control requests only need small bodies.
export const smallJson = express.json({ limit: '100kb', inflate: false });

// Prompts and translation input can contain substantially more text.
export const llmJson = express.json({ limit: '2mb', inflate: false });
