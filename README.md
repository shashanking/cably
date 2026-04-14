# GIS Telecom Network Asset Management Platform

A Next.js application for visualizing, managing, and analyzing telecom network
infrastructure assets using GIS data.

## QGIS + App Workflow

- Use QGIS to build, clean, or edit KML datasets.
- Export KML from QGIS and upload it into this application.
- Collect asset data directly in the app if you need immediate source
  collection.
- Export current assets back to KML for further QGIS processing.

## Features

- Upload and parse KML/GeoJSON files
- Collect asset points manually through the app
- Export current assets as KML for QGIS
- Visualize network assets on an interactive Google Map
- Store assets in Supabase with JSON geometry

## Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in `.env.local`
4. Run the development server: `npm run dev`

## Tech Stack

- Next.js
- Supabase (PostGIS)
- Google Maps API
- TypeScript
- Tailwind CSS

This project uses
[`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts)
to automatically optimize and load [Geist](https://vercel.com/font), a new font
family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js
  features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out
[the Next.js GitHub repository](https://github.com/vercel/next.js) - your
feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the
[Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme)
from the creators of Next.js.

Check out our
[Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying)
for more details.
