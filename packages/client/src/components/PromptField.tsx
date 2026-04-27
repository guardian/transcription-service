import { Button, Label, Select, Textarea } from 'flowbite-react';
import React from 'react';
import type { LlmBackend } from '@guardian/transcription-service-common';

interface PromptFieldProps {
	id: string;
	label: string;
	description: string;
	value: string;
	onChange: (value: string) => void;
	rows?: number;
}

interface BackendPickerProps {
	value: LlmBackend;
	onChange: (value: LlmBackend) => void;
}

export const BackendPicker = ({ value, onChange }: BackendPickerProps) => (
	<div className="mb-4">
		<Label className="text-base" htmlFor="backend" value="Backend" />
		<Select
			id="backend"
			value={value}
			onChange={(e) => onChange(e.target.value as LlmBackend)}
		>
			<option value="BEDROCK">Bedrock</option>
			<option value="LOCAL">Local (llama.cpp)</option>
		</Select>
	</div>
);

export const PromptField = ({
	id,
	label,
	description,
	value,
	onChange,
	rows = 4,
}: PromptFieldProps) => (
	<div className="mb-4">
		<div className="mb-1 flex items-center justify-between">
			<div>
				<Label className="text-base" htmlFor={id} value={label} />
				<p className="font-light">{description}</p>
			</div>
			{value && (
				<Button size="xs" color="light" onClick={() => onChange('')}>
					Clear
				</Button>
			)}
		</div>
		<Textarea
			id={id}
			rows={rows}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			className="font-mono text-sm"
		/>
	</div>
);
