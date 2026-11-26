'use client';

import { Selector } from '@astryxdesign/core/Selector';

const zones = ['UTC', ...Intl.supportedValuesOf('timeZone')];

export function appointmentTimeLabel(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
}

export function TimeZoneSelector({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const options = zones.includes(value) ? zones : [value, ...zones];
  return <Selector label="Time zone" value={value} onChange={choice => onChange(choice || 'UTC')} hasSearch
    options={options.map(zone => ({ value: zone, label: zone.replaceAll('_', ' ') }))} />;
}

export function SlotPicker({ slots, timeZone, value, onChange }: {
  slots: string[]; timeZone: string; value: string; onChange: (value: string) => void;
}) {
  const formatDay = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone });
  const formatTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone, timeZoneName: 'short' });
  const days = Map.groupBy(slots, slot => formatDay.format(new Date(slot)));
  const currentDay = value ? formatDay.format(new Date(value)) : days.keys().next().value;
  const currentSlots = days.get(currentDay ?? '') ?? [];
  return <div className="ov-form-grid">
    <Selector label="Date" value={currentDay ?? undefined}
      onChange={day => onChange(days.get(day ?? '')?.[0] ?? '')}
      options={[...days.keys()].map(day => ({ value: day, label: day }))} />
    <Selector label="Time" value={value || undefined} placeholder="Choose a time"
      onChange={slot => onChange(slot ?? '')}
      options={currentSlots.map(slot => ({ value: slot, label: formatTime.format(new Date(slot)) }))} />
  </div>;
}
