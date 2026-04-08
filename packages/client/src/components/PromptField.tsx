import { Button, Label, Textarea } from 'flowbite-react';
import React from 'react';

interface PromptFieldProps {
	id: string;
	label: string;
	description: string;
	value: string;
	onChange: (value: string) => void;
	rows?: number;
}

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
