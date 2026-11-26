// The OVELIO email template gallery: 24 editable MJML templates, three in each category.
import type { EmailTemplateSummary } from '@/contracts/studio';
import { campaignTemplates } from './campaigns';
import { factoryIndustries, factoryTemplates, factoryUseCases } from './factory';
import { newsletterTemplates } from './newsletters';
import type { EmailTemplate } from './shared';

export type { EmailTemplate } from './shared';

/** The 24 hand-built templates. */
export const emailTemplates: EmailTemplate[] = [...newsletterTemplates, ...campaignTemplates];

/** Hand-built templates followed by the factory output, as the gallery lists them. */
export const allTemplates: EmailTemplate[] = [...emailTemplates, ...factoryTemplates];

export { factoryIndustries, factoryUseCases };

export function findTemplate(key: string): EmailTemplate | undefined {
  return allTemplates.find(item => item.key === key);
}

export function templateSummary(template: EmailTemplate): EmailTemplateSummary {
  const { mjml: _mjml, ...summary } = template;
  void _mjml;
  return { source: 'curated', ...summary };
}
