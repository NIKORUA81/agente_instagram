import type { AutomationTrigger } from '@wolfiax/shared';

/** Contexto del evento entrante contra el que se evalúan los disparadores. */
export interface TriggerContext {
  /** Tipo de mensaje entrante ya persistido */
  kind: 'message' | 'story_reply' | 'reaction';
  text: string | null;
  isNewContact: boolean;
}

/** Normaliza para matching: minúsculas y sin acentos ("Precio" ≈ "precio", "café" ≈ "cafe"). */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function matchesTrigger(trigger: AutomationTrigger, ctx: TriggerContext): boolean {
  switch (trigger.type) {
    case 'any_message':
      return ctx.kind === 'message' || ctx.kind === 'story_reply';

    case 'keyword': {
      if (!ctx.text) return false;
      const haystack = normalizeText(ctx.text);
      const match = trigger.match ?? 'contains';
      return trigger.keywords.some((kw) => {
        const needle = normalizeText(kw);
        if (needle.length === 0) return false;
        return match === 'exact' ? haystack === needle : haystack.includes(needle);
      });
    }

    case 'story_reply':
      return ctx.kind === 'story_reply';

    case 'reaction':
      return ctx.kind === 'reaction';

    case 'new_contact':
      return ctx.isNewContact;

    default:
      return false;
  }
}
