import React, { Suspense } from 'react';
import { Ocr } from '@/components/Ocr';

export default function OcrPage() {
	return (
		<Suspense fallback={<p>Loading…</p>}>
			<Ocr />
		</Suspense>
	);
}
