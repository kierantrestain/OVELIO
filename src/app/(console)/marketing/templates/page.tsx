import { Suspense } from 'react';
import { TemplateGallery } from '@/components/studio/gallery';

export const metadata = { title: 'Templates' };

export default function Page() {
  return <Suspense><TemplateGallery /></Suspense>;
}
