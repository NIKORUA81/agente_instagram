import { matchesTrigger, normalizeText } from './matcher';

describe('normalizeText', () => {
  it('quita acentos y baja a minúsculas', () => {
    expect(normalizeText('  ¿CUÁNTO cuesta el Café?  ')).toBe('¿cuanto cuesta el cafe?');
  });
});

describe('matchesTrigger', () => {
  const msg = (text: string | null, isNewContact = false) => ({
    kind: 'message' as const,
    text,
    isNewContact,
  });

  it('keyword contains: insensible a mayúsculas y acentos', () => {
    const trigger = { type: 'keyword' as const, keywords: ['precio', 'cuánto'] };
    expect(matchesTrigger(trigger, msg('Hola, ¿me pasas el PRECIO?'))).toBe(true);
    expect(matchesTrigger(trigger, msg('¿Cuanto vale?'))).toBe(true);
    expect(matchesTrigger(trigger, msg('Buenas tardes'))).toBe(false);
    expect(matchesTrigger(trigger, msg(null))).toBe(false);
  });

  it('keyword exact: solo el texto completo', () => {
    const trigger = { type: 'keyword' as const, keywords: ['info'], match: 'exact' as const };
    expect(matchesTrigger(trigger, msg('INFO'))).toBe(true);
    expect(matchesTrigger(trigger, msg('quiero info'))).toBe(false);
  });

  it('keyword con emoji', () => {
    const trigger = { type: 'keyword' as const, keywords: ['🔥'] };
    expect(matchesTrigger(trigger, msg('esto está 🔥🔥'))).toBe(true);
  });

  it('any_message: mensajes y story replies, no reacciones', () => {
    const trigger = { type: 'any_message' as const };
    expect(matchesTrigger(trigger, msg('hola'))).toBe(true);
    expect(matchesTrigger(trigger, { kind: 'story_reply', text: '😍', isNewContact: false })).toBe(true);
    expect(matchesTrigger(trigger, { kind: 'reaction', text: '❤️', isNewContact: false })).toBe(false);
  });

  it('story_reply y reaction discriminan por tipo de evento', () => {
    expect(
      matchesTrigger({ type: 'story_reply' }, { kind: 'story_reply', text: 'wow', isNewContact: false }),
    ).toBe(true);
    expect(matchesTrigger({ type: 'story_reply' }, msg('wow'))).toBe(false);
    expect(
      matchesTrigger({ type: 'reaction' }, { kind: 'reaction', text: '❤️', isNewContact: false }),
    ).toBe(true);
  });

  it('new_contact solo para primer contacto', () => {
    expect(matchesTrigger({ type: 'new_contact' }, msg('hola', true))).toBe(true);
    expect(matchesTrigger({ type: 'new_contact' }, msg('hola', false))).toBe(false);
  });
});
