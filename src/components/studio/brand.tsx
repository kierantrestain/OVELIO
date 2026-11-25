'use client';

// Marketing › Brand kit: one record (logo, colours, fonts, footer, social links) applied whenever a template becomes a
// design, and used by the studio's Brand header and Brand footer blocks.
import { ImageIcon, Plus, Save, Trash2 } from 'lucide-react';
import NextLink from 'next/link';
import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { BrandKit, SocialNetwork } from '@/contracts/studio';
import { emailFonts, socialNetworks } from '@/contracts/studio';
import { api, useAction, useResource } from '../client';
import { useUser } from '../shell';
import { AsyncState, Feedback, FormActions, PageHeader, Panel } from '../ui';
import { EmailFrame, MediaPicker } from './common';
import '@/styles/studio.css';

const colourFields: { key: 'primary' | 'accent' | 'text' | 'muted' | 'background' | 'surface'; label: string }[] = [
  { key: 'primary', label: 'Primary (buttons, links)' }, { key: 'accent', label: 'Accent' }, { key: 'text', label: 'Text' },
  { key: 'muted', label: 'Muted text' }, { key: 'background', label: 'Email background' }, { key: 'surface', label: 'Content background' },
];
const networkLabel: Record<SocialNetwork, string> = { website: 'Website', linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', x: 'X', youtube: 'YouTube', tiktok: 'TikTok' };

export function BrandKitPage() {
  const brand = useResource<BrandKit>('/studio/brand');
  return brand.data ? <BrandForm key={brand.data.updatedAt ?? 'default'} initial={brand.data} onSaved={brand.refresh} />
    : <div className="ov-stack"><PageHeader title="Brand kit" /><Panel><AsyncState loading={brand.loading} error={brand.error} retry={brand.refresh} /></Panel></div>;
}

function BrandForm({ initial, onSaved }: { initial: BrandKit; onSaved: () => void }) {
  const canEdit = useUser().role !== 'analyst';
  const [kit, setKit] = useState(initial);
  const [picking, setPicking] = useState(false);
  const [sample, setSample] = useState(0);
  const action = useAction();
  const preview = useResource<{ html: string }>(`/studio/templates/newsletter-digest/html?v=${initial.updatedAt ?? ''}-${sample}`);
  const set = <K extends keyof BrandKit>(key: K, value: BrandKit[K]) => setKit(current => ({ ...current, [key]: value }));

  return <div className="ov-stack">
    <PageHeader title="Brand kit" description="Your logo, colours, fonts and footer. New emails from templates use them automatically."
      actions={canEdit ? <Button variant="primary" icon={<Save size={16} />} label="Save brand kit" isLoading={action.busy} onClick={() => void action.run(async () => {
        const { updatedAt: _updatedAt, ...input } = kit;
        void _updatedAt;
        await api('/studio/brand', 'PUT', input);
        onSaved();
        setSample(value => value + 1);
      }, 'Brand kit saved. New emails from templates use it; existing designs keep their look.')} /> : undefined} />
    <Feedback error={action.error} notice={action.notice} />
    <div className="ov-grid">
      <div className="ov-stack">
        <Panel title="Logo and name">
          <TextInput label="Brand name" value={kit.name} onChange={value => set('name', value)} isRequired description="Shown instead of a logo when none is set." />
          <div className="ov-actions">
            {kit.logoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={kit.logoUrl} alt="Current logo" style={{ maxHeight: 48, maxWidth: 200 }} />
              : <Text color="secondary">No logo yet — the brand name is used.</Text>}
            <Button size="sm" icon={<ImageIcon size={14} />} label={kit.logoUrl ? 'Replace logo' : 'Choose logo'} onClick={() => setPicking(true)} isDisabled={!canEdit} />
            {kit.logoUrl ? <Button size="sm" variant="ghost" label="Remove" onClick={() => set('logoUrl', '')} /> : null}
          </div>
          <NumberInput label="Logo width (px)" value={kit.logoWidth} onChange={value => set('logoWidth', Number(value) || 140)} min={40} max={400} />
          <TextInput label="Website" value={kit.website} onChange={value => set('website', value)} placeholder="https://example.com" isOptional />
        </Panel>
        <Panel title="Colours">
          <div className="ov-studio-brand-grid">
            {colourFields.map(field => <label key={field.key} className="ov-studio-color">
              <span>{field.label}</span>
              <div>
                <input type="color" value={kit[field.key]} onChange={event => set(field.key, event.target.value)} aria-label={`${field.label} colour picker`} />
                <input type="text" value={kit[field.key]} onChange={event => set(field.key, event.target.value)} aria-label={`${field.label} hex value`} maxLength={7} />
              </div>
            </label>)}
          </div>
        </Panel>
        <Panel title="Fonts" description="Email-safe font stacks that render in every inbox without downloading web fonts.">
          <div className="ov-form-grid">
            <Selector label="Headings" value={kit.headingFont} onChange={value => set('headingFont', value ?? emailFonts[0].value)} options={emailFonts} />
            <Selector label="Body text" value={kit.bodyFont} onChange={value => set('bodyFont', value ?? emailFonts[0].value)} options={emailFonts} />
          </div>
        </Panel>
        <Panel title="Footer and social links" description="Every marketing email also shows your postal address (Settings › Company) and an unsubscribe link.">
          <TextArea label="Footer text" rows={3} value={kit.footerText} onChange={value => set('footerText', value)} />
          {kit.social.map((item, index) => <div key={index} className="ov-actions">
            <Selector label="Network" isLabelHidden value={item.network} width={150} options={socialNetworks.map(value => ({ value, label: networkLabel[value] }))}
              onChange={value => set('social', kit.social.map((entry, i) => i === index ? { ...entry, network: (value ?? 'website') as SocialNetwork } : entry))} />
            <TextInput label="Profile address" isLabelHidden value={item.url} placeholder="https://…" width={300}
              onChange={value => set('social', kit.social.map((entry, i) => i === index ? { ...entry, url: value } : entry))} />
            <IconButton size="sm" variant="ghost" label={`Remove ${networkLabel[item.network]}`} icon={<Trash2 size={15} />} onClick={() => set('social', kit.social.filter((_, i) => i !== index))} />
          </div>)}
          <FormActions><Button size="sm" icon={<Plus size={14} />} label="Add social link" isDisabled={kit.social.length >= 8} onClick={() => set('social', [...kit.social, { network: 'linkedin', url: '' }])} /></FormActions>
        </Panel>
      </div>
      <Panel title="How templates look with your brand" description="Saved settings, shown on the Monthly digest template. In the studio, Brand header and Brand footer blocks use the same kit."
        action={<NextLink href="/marketing/templates?tab=blocks">Saved blocks</NextLink>}>
        {preview.data ? <EmailFrame html={preview.data.html} title="Brand preview" height={760} /> : <AsyncState loading={preview.loading} error={preview.error} retry={preview.refresh} />}
      </Panel>
    </div>
    {picking ? <MediaPicker onClose={() => setPicking(false)} onPick={url => {
      setPicking(false);
      if (url.startsWith('data:')) { void action.run(async () => { throw new Error('Choose an uploaded image or an image address for the logo.'); }); return; }
      set('logoUrl', url);
    }} /> : null}
  </div>;
}
