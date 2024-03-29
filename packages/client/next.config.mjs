/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,
	output: 'export',
	rewrites: async () => {
		return [
			{
				source: '/api/:any*',
				destination: 'http://localhost:9103/api/:any*',
			},
		];
	},
};

export default nextConfig;
