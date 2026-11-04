
import { useEffect, useState, type ReactNode } from 'react'

/** Kudy se v Safari dá na Sdílet, Apple to mění skoro každý rok. */
type Lista = 'sdilet' | 'tecky' | 'carky'

type Zarizeni =
  | { druh: 'pocitac' }
  | { druh: 'ios'; lista: Lista }
  | { druh: 'ios-prohlizec' }
  | { druh: 'vestaveny'; appka: string; ios: boolean }
  | { druh: 'android' }

const ADRESA = 'https://brain.growbeyond.cz/instalace'

function pozna(): Zarizeni | 'nainstalovano' {
  const ua = navigator.userAgent
  const naPlose =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  if (naPlose) return 'nainstalovano'

  const ios = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const android = /Android/.test(ua)

  // Vestavěný prohlížeč appky: přidat na plochu z něj nejde vůbec.
  const vestaveny = /Instagram/.test(ua) ? 'Instagram' : /FBAN|FBAV|FB_IAB/.test(ua) ? 'Facebook' : /TikTok|musical_ly/i.test(ua) ? 'TikTok' : /LinkedInApp/.test(ua) ? 'LinkedIn' : null
  if ((ios || android) && vestaveny) return { druh: 'vestaveny', appka: vestaveny, ios }

  if (ios) {
    if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return { druh: 'ios-prohlizec' }
    // iOS 26 schoval Sdílet pod tři tečky vpravo, iOS 27 pod tři čárky v adrese
    // a vpravo má panely. Systém v UA tají, verze Safari ne.
    const verze = Number(ua.match(/Version\/(\d+)/)?.[1] ?? 0)
    return { druh: 'ios', lista: verze >= 27 ? 'carky' : verze >= 26 ? 'tecky' : 'sdilet' }
  }
  if (android) return { druh: 'android' }
  return { druh: 'pocitac' }
}

/** Událost Chromia, která dovolí vlastní tlačítko instalace. Safari ji nemá. */
type VyzvaInstalace = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

function Krok({ cislo, children, ukazka }: { cislo: number; children: ReactNode; ukazka?: ReactNode }) {
  return (
    <li className="i-krok">
      <span className="i-cislo">{cislo}</span>
      <span className="i-krok-text">{children}</span>
      {ukazka ? <span className="i-ukazka">{ukazka}</span> : null}
    </li>
  )
}

const TriTecky = () => (
  <span className="i-kolecko" aria-hidden="true">
    <svg width="18" height="4" viewBox="0 0 18 4" fill="currentColor"><circle cx="2" cy="2" r="2" /><circle cx="9" cy="2" r="2" /><circle cx="16" cy="2" r="2" /></svg>
  </span>
)

const TriCarky = () => (
  <span className="i-kolecko" aria-hidden="true">
    <svg width="20" height="16" viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 2h16M2 8h16M2 14h11" /></svg>
  </span>
)

const Sdilet = () => (
  <svg width="20" height="24" viewBox="0 0 20 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 15V2M5.5 6 10 1.5 14.5 6" /><path d="M6 10H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2" />
  </svg>
)

const Sipka = () => (
  <span className="i-kolecko" aria-hidden="true">
    <svg width="20" height="12" viewBox="0 0 20 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m2 2 8 8 8-8" /></svg>
  </span>
)

const Plus = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <rect x="1.5" y="1.5" width="19" height="19" rx="5" /><path d="M11 6.5v9M6.5 11h9" />
  </svg>
)

const Radek = ({ ikona, text }: { ikona: ReactNode; text: string }) => (
  <span className="i-radek">
    {ikona}
    {text}
  </span>
)

function KopirovatOdkaz() {
  const [hotovo, setHotovo] = useState(false)
  return (
    <button
      type="button"
      className="i-tlacitko"
      onClick={() => {
        void navigator.clipboard?.writeText(ADRESA).then(() => setHotovo(true))
      }}
    >
      {hotovo ? 'Zkopírováno' : 'Zkopírovat odkaz'}
    </button>
  )
}

function Hlava({ nadpis, popis }: { nadpis: string; popis?: string }) {
  return (
    <header className="i-hlava">
      <img src="/icons/icon-192x192.png" alt="" width={84} height={84} className="i-ikona" />
      <h1>{nadpis}</h1>
      {popis ? <p>{popis}</p> : null}
    </header>
  )
}

const Dojezd = () => (
  <p className="i-poznamka">Pak otevři Brain z plochy, přihlas se a ve Více zapni notifikace</p>
)

function Ios({ lista }: { lista: Lista }) {
  const novy = lista !== 'sdilet'
  const polohaSipky = { sdilet: 'is-stred', tecky: 'is-vpravo', carky: 'is-vlevo' }[lista]
  return (
    <>
      <Hlava nadpis="Nainstaluj si Brain" />
      <ol className="i-kroky">
        {novy ? (
          <>
            {lista === 'carky' ? (
              <Krok cislo={1} ukazka={<TriCarky />}>Klepni na tři čárky vlevo v adrese</Krok>
            ) : (
              <Krok cislo={1} ukazka={<TriTecky />}>Klepni na tři tečky vedle adresy</Krok>
            )}
            <Krok cislo={2} ukazka={<Radek ikona={<Sdilet />} text="Sdílet" />}>Vyber Sdílet</Krok>
            <Krok cislo={3} ukazka={<Sipka />}>Rozbal Zobrazit další</Krok>
          </>
        ) : (
          <>
            <Krok cislo={1} ukazka={<span className="i-kolecko"><Sdilet /></span>}>Dole klepni na Sdílet</Krok>
            <Krok cislo={2}>Posuň nabídku níž</Krok>
          </>
        )}
        <Krok cislo={novy ? 4 : 3} ukazka={<Radek ikona={<Plus />} text="Přidat na plochu" />}>Vyber Přidat na plochu</Krok>
        <Krok cislo={novy ? 5 : 4} ukazka={<span className="i-pilulka">Přidat</span>}>Vpravo nahoře potvrď</Krok>
      </ol>
      <Dojezd />
      {/* Safari lištu dole nepřekryje, šipka míří tam, kde je tlačítko. */}
      <div className={`i-sipka ${polohaSipky}`} aria-hidden="true">
        <svg width="34" height="46" viewBox="0 0 34 46" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3v38M4 28l13 14 13-14" /></svg>
      </div>
    </>
  )
}

function Android() {
  const [vyzva, setVyzva] = useState<VyzvaInstalace | null>(null)
  const [hotovo, setHotovo] = useState(false)

  useEffect(() => {
    const zachyt = (e: Event) => {
      e.preventDefault()
      setVyzva(e as VyzvaInstalace)
    }
    const nainstalovano = () => setHotovo(true)
    window.addEventListener('beforeinstallprompt', zachyt)
    window.addEventListener('appinstalled', nainstalovano)
    return () => {
      window.removeEventListener('beforeinstallprompt', zachyt)
      window.removeEventListener('appinstalled', nainstalovano)
    }
  }, [])

  if (hotovo) return <Hlava nadpis="Hotovo" popis="Brain najdeš na ploše, otevři ho a přihlas se" />

  return (
    <>
      <Hlava nadpis="Nainstaluj si Brain" />
      {vyzva ? (
        <button
          type="button"
          className="i-tlacitko is-plne"
          onClick={() => {
            void vyzva.prompt()
            void vyzva.userChoice.then(() => setVyzva(null))
          }}
        >
          Nainstalovat Brain
        </button>
      ) : (
        <ol className="i-kroky">
          <Krok cislo={1}>V Chromu otevři nabídku se třemi tečkami</Krok>
          <Krok cislo={2}>Vyber Přidat na plochu</Krok>
          <Krok cislo={3}>Potvrď Nainstalovat</Krok>
        </ol>
      )}
    </>
  )
}

function Pocitac() {
  return (
    <div className="i-pocitac">
      <img src="/brain-qr.svg" alt="QR kód na instalaci Brainu" width={320} height={320} className="i-qr" />
      <h1>Brain do telefonu</h1>
      <p>Namiř na kód foťák telefonu a my tě provedeme zbytkem, zabere to pár vteřin</p>
    </div>
  )
}

export function Navod() {
  const [zarizeni, setZarizeni] = useState<Zarizeni | null>(null)

  useEffect(() => {
    const z = pozna()
    if (z === 'nainstalovano') {
      window.location.replace('/m')
      return
    }
    setZarizeni(z)
  }, [])

  return (
    <main className="i-stranka">
      <div className="i-obsah">
        {zarizeni?.druh === 'pocitac' ? <Pocitac /> : null}
        {zarizeni?.druh === 'ios' ? <Ios lista={zarizeni.lista} /> : null}
        {zarizeni?.druh === 'android' ? <Android /> : null}
        {zarizeni?.druh === 'ios-prohlizec' ? (
          <>
            <Hlava nadpis="Otevři to v Safari" popis="Na iPhonu jde Brain na plochu nejjistěji přidat ze Safari, vlož tam tenhle odkaz" />
            <KopirovatOdkaz />
          </>
        ) : null}
        {zarizeni?.druh === 'vestaveny' ? (
          <>
            <Hlava
              nadpis={zarizeni.ios ? 'Otevři to v Safari' : 'Otevři to v Chromu'}
              popis={`${zarizeni.appka} otevřel vlastní prohlížeč a z toho se na plochu přidat nedá. Klepni na tři tečky nahoře a vyber otevření v prohlížeči, nebo si zkopíruj odkaz`}
            />
            <KopirovatOdkaz />
          </>
        ) : null}
      </div>
    </main>
  )
}
