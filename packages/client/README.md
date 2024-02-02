This project uses [Next.js](https://nextjs.org/) which is a project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
```

Open [https://transcribe.local.dev-gutools.co.uk/](https://transcribe.local.dev-gutools.co.uk/) with your browser to see the result.

You can start editing the page by modifying `src/app/page.tsx`. To create new route you can follow the pattern for about page. For more info look at the p[ages](https://nextjs.org/docs/app/building-your-application/routing/pages-and-layouts#pages) documentation. 

`app/layout.tsx` is the root layout that is applied to all pages. To learn more about layouts read through [layout documentation](https://nextjs.org/docs/app/building-your-application/routing/pages-and-layouts#layouts).  

`app/template.tsx` is the template file that similar to layout can be shared between routes but when a user navigates between routes that share a template, a new instance of the component is mounted, and DOM elements are recreated. more info can be found [here in nextjs documentation](https://nextjs.org/docs/app/building-your-application/routing/pages-and-layouts#templates)

This project uses [`next/font`](https://nextjs.org/docs/basic-features/font-optimization) to automatically optimize and load Inter, a custom Google Font.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!