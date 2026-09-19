import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Beyond Brain — speech-to-text (dictation) via the browser Web Speech API.
 *
 * Czech by default (`cs-CZ`). Works in Chromium (Chrome/Edge) and Safari; the
 * hook reports `supported=false` elsewhere so the mic button can hide. Interim
 * results stream into the composer live; final chunks are folded into a base so
 * repeated pauses (the API stops on silence) keep appending instead of resetting.
 */

function getRecognitionCtor(): any | null {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

type Options = {
  lang?: string;
  /** Sets the composer value (base text + dictation so far). */
  onValue: (value: string) => void;
  /** Returns the current composer value when dictation starts. */
  getBase: () => string;
};

export function useBeyondSpeech({ lang = 'cs-CZ', onValue, getBase }: Options) {
  const supported = Boolean(getRecognitionCtor());
  const [listening, setListening] = useState(false);

  const recRef = useRef<any>(null);
  const baseRef = useRef('');       // composer text captured when dictation began
  const finalRef = useRef('');      // finalized dictation accumulated this run
  const wantRef = useRef(false);    // user still wants to listen (drives auto-restart)
  const onValueRef = useRef(onValue);
  const getBaseRef = useRef(getBase);
  onValueRef.current = onValue;
  getBaseRef.current = getBase;

  const compose = useCallback((interim: string) => {
    const base = baseRef.current;
    const dict = `${finalRef.current}${interim}`.replace(/\s+/g, ' ').trimStart();
    if (!dict) return base;
    const sep = base && !/\s$/.test(base) ? ' ' : '';
    return base + sep + dict;
  }, []);

  const stop = useCallback(() => {
    wantRef.current = false;
    setListening(false);
    try { recRef.current?.stop(); } catch { /* not started */ }
  }, []);

  const start = useCallback(async () => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    // Mark intent up-front so a second tap during the async permission step can
    // cancel cleanly.
    wantRef.current = true;

    // Explicitly request the microphone. On Android (and installed PWAs) the
    // Web Speech API alone usually does NOT surface a permission prompt, and no
    // microphone entry appears in the site's settings until getUserMedia has
    // been called once. Doing it here forces the OS/browser permission dialog.
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // We don't need the raw stream — SpeechRecognition captures its own.
        stream.getTracks().forEach((t) => t.stop());
      }
    } catch {
      wantRef.current = false;
      setListening(false);
      window.alert(
        'Nepovedlo se zapnout mikrofon.\n\n' +
        'Povol mikrofon pro tuto stránku: ťukni na ikonu zámku (nebo ⋮ → Informace o webu) ' +
        'v adresním řádku → Oprávnění → Mikrofon → Povolit, a zkus to znovu.',
      );
      return;
    }

    // User tapped the mic again during the permission prompt → abort.
    if (!wantRef.current) { setListening(false); return; }

    baseRef.current = getBaseRef.current();
    finalRef.current = '';

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0]?.transcript ?? '';
        if (e.results[i].isFinal) finalRef.current += chunk;
        else interim += chunk;
      }
      onValueRef.current(compose(interim));
    };

    rec.onerror = (e: any) => {
      const err = e?.error;
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        wantRef.current = false;
        setListening(false);
        window.alert('Diktování nemá povolený mikrofon. Povol přístup k mikrofonu v prohlížeči a zkus to znovu.');
      } else if (err === 'audio-capture') {
        wantRef.current = false;
        setListening(false);
        window.alert('Nenašel se mikrofon. Zkontroluj, že je připojený a povolený.');
      } else if (err === 'network') {
        // Android's speech service needs connectivity / Google speech; stop so
        // we don't loop restart→network→restart.
        wantRef.current = false;
        setListening(false);
        window.alert('Rozpoznávání řeči teď není dostupné (chybí připojení nebo hlasová služba zařízení).');
      }
      // 'no-speech' / 'aborted' → let onend decide whether to restart.
    };

    rec.onend = () => {
      if (wantRef.current) {
        // The API stops on silence; fold the run into the base and resume so a
        // pause doesn't end dictation mid-thought.
        baseRef.current = compose('');
        finalRef.current = '';
        try { rec.start(); } catch { wantRef.current = false; setListening(false); }
      } else {
        setListening(false);
      }
    };

    recRef.current = rec;
    wantRef.current = true;
    try {
      rec.start();
      setListening(true);
    } catch {
      // already started — ignore
    }
  }, [lang, compose]);

  const toggle = useCallback(() => {
    if (wantRef.current) stop();
    else start();
  }, [start, stop]);

  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* noop */ } }, []);

  return { supported, listening, start, stop, toggle };
}
