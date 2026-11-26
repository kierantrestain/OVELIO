'use client';

// Marketing › Brand kit: one record (logo, colours, fonts, footer, social links) applied whenever a template becomes a
// design, and used by the studio's Brand header and Brand footer blocks.
import { ImageIcon, Plus, Save, Trash2 } from 'lucide-react';
import NextLink from 'next/link';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { BrandKit, BrandSummary, SocialNetwork } from '@/contracts/studio';
import { emailFonts, socialNetworks } from '@/contracts/studio';
import { api, useAction, useResource } from '../client';
import { useUser } from '../shell';
import { AsyncState, ConfirmDialog, Feedback, FormActions, Modal, PageHeader, Panel, StatusBadge } from '../ui';
import { EmailFrame, MediaPicker } from './common';
import '@/styles/studio.css';

const colourFields: { key: 'primary' | 'accent' | 'text' | 'muted' | 'background' | 'surface'; label: string }[] = [
  { key: 'primary', label: 'Primary (buttons, links)' }, { key: 'accent', label: 'Accent' }, { key: 'text', label: 'Text' },
  { key: 'muted', label: 'Muted text' }, { key: 'background', label: 'Email background' }, { key: 'surface', label: 'Content background' },
];
const networkLabel: Record<SocialNetwork, string> = { website: 'Website', linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', x: 'X', youtube: 'YouTube', tiktok: 'TikTok' };

export function BrandKitPage() {
  const brands = useResource<{ items: BrandSummary[] }>('/studio/brands');
  const fallback = useResource<BrandKit>('/studio/brand');
  const [selected, setSelected] = useState<string>();
  const [naming, setNaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState('');
  const action = useAction();
  const items = brands.data?.items ?? [];
  const current = items.find(item => item.id === selected) ?? items.find(item => item.isDefault) ?? items[0];
  if (!brands.data || !fallback.data) return <div className="ov-stack"><PageHeader title="Brand kits" /><Panel><AsyncState loading={brands.loading || fallback.loading} error={brands.error || fallback.error} retry={() => { brands.refresh(); fallback.refresh(); }} /></Panel></div>;
  const switcher = <div className="ov-actions">
    {items.length ? <Selector label="Brand kit" isLabelHidden width={260} value={current?.id ?? ''} onChange={value => setSelected(value ?? undefined)}
      options={items.map(item => ({ value: item.id, label: item.name + (item.isDefault ? ' (default)' : '') }))} /> : null}
    {current && !current.isDefault ? <Button size="sm" label="Make default" isLoading={action.busy} onClick={() => void action.run(async () => { await api(`/studio/brands/${current.id}/default`, 'POST'); brands.refresh(); }, `${current.name} is now the default brand kit.`)} /> : null}
    {current && !current.isDefault ? <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} label="Delete" onClick={() => setDeleting(true)} /> : null}
    <Button size="sm" icon={<Plus size={14} />} label="New brand kit" onClick={() => { setName(''); setNaming(true); }} />
  </div>;
  return <>
    <BrandForm key={(current?.id ?? 'default') + (current?.updatedAt ?? '')} brandId={current?.id} isDefault={current?.isDefault ?? true}
      initial={current?.kit ?? fallback.data} switcher={switcher} onSaved={() => { brands.refresh(); fallback.refresh(); }} />
    <Feedback error={action.error} notice={action.notice} />
    {naming ? <Modal title="New brand kit" onClose={() => setNaming(false)}>
      <form className="ov-stack-sm" onSubmit={event => { event.preventDefault(); void action.run(async () => {
        const created = await api<BrandSummary>('/studio/brands', 'POST', { name: name.trim() });
        setNaming(false);
        setSelected(created.id);
        brands.refresh();
      }); }}>
        <TextInput label="Name" value={name} onChange={setName} placeholder="e.g. Client: Northbridge" isRequired description="Starts as a copy of the default kit." />
        <FormActions><Button label="Cancel" onClick={() => setNaming(false)} /><Button type="submit" variant="primary" label="Create" isDisabled={!name.trim()} isLoading={action.busy} /></FormActions>
      </form>
    </Modal> : null}
    {deleting && current ? <ConfirmDialog title={`Delete ${current.name}?`} description="Designs using it keep their current look and fall back to the default kit for new brand blocks." actionLabel="Delete brand kit"
      busy={action.busy} onClose={() => setDeleting(false)} onConfirm={() => void action.run(async () => {
        await api(`/studio/brands/${current.id}`, 'DELETE');
        setDeleting(false);
        setSelected(undefined);
        brands.refresh();
      }, 'Brand kit deleted.')} /> : null}
  </>;
}

function BrandForm({ initial, brandId, isDefault, switcher, onSaved }: { initial: BrandKit; brandId?: string; isDefault: boolean; switcher: ReactNode; onSaved: () => void }) {
  const canEdit = useUser().role !== 'analyst';
  const [kit, setKit] = useState(initial);
  const [picking, setPicking] = useState(false);
  const [sample, setSample] = useState(0);
  const action = useAction();
  const preview = useResource<{ html: string }>(`/studio/templates/newsletter-digest/html?v=${initial.updatedAt ?? ''}-${sample}${brandId ? `&brandId=${brandId}` : ''}`);
  const set = <K extends keyof BrandKit>(key: K, value: BrandKit[K]) => setKit(current => ({ ...current, [key]: value }));

  return <div className="ov-stack">
    <PageHeader title="Brand kits" description="Logo, colours, fonts, buttons and footer. New emails use the default kit; switch an email's kit in the studio to re-theme it."
      actions={canEdit ? <Button variant="primary" icon={<Save size={16} />} label="Save brand kit" isLoading={action.busy} onClick={() => void action.run(async () => {
        const { updatedAt: _updatedAt, ...input } = kit;
        void _updatedAt;
        await api(brandId ? `/studio/brands/${brandId}` : '/studio/brand', 'PUT', input);
        onSaved();
        setSample(value => value + 1);
      }, 'Brand kit saved. New emails from templates use it; existing designs keep their look.')} /> : undefined} />
    <div className="ov-actions ov-actions--between">{switcher}{isDefault ? <StatusBadge label="Default kit" tone="success" /> : null}</div>
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
        <Panel title="Buttons" description="The global button style for templates and brand blocks.">
          <div className="ov-form-grid">
            <Selector label="Style" value={kit.buttonStyle} onChange={value => set('buttonStyle', value === 'outline' ? 'outline' : 'filled')}
              options={[{ value: 'filled', label: 'Filled with the primary colour' }, { value: 'outline', label: 'Outline in the primary colour' }]} />
            <NumberInput label="Corner radius (px)" value={kit.buttonRadius} onChange={value => set('buttonRadius', Math.min(30, Math.max(0, Number(value) || 0)))} min={0} max={30} />
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
