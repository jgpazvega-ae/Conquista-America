import { CivilizationType } from '../game/types';

interface Beat {
  chapter: string;
  title: string;
  text: string;
  bg: string; // CSS background (gradient/scene tint)
}

// ── Shared arc: the arrival of the colonizers ────────────────────────────────
function nativeBeats(civName: string, homeland: string, year: string, omen: string): Beat[] {
  return [
    {
      chapter: 'Año ' + year,
      title: homeland,
      text: `Durante siglos, ${civName} floreció sin conocer rival. Ciudades de piedra tocaban el cielo, los mercados rebosaban de oro, jade y cacao, y los dioses parecían favorecer a su pueblo. Nadie imaginaba que el mundo estaba a punto de partirse en dos.`,
      bg: 'radial-gradient(ellipse at 50% 30%, #3a2a10 0%, #0a0805 70%)',
    },
    {
      chapter: 'Presagios',
      title: 'Señales en el cielo',
      text: `${omen} Los sacerdotes hablaban en voz baja de un retorno, de barbas y pieles pálidas, de hombres que vendrían del mar del oriente. El miedo se mezclaba con la profecía.`,
      bg: 'radial-gradient(ellipse at 50% 20%, #4a2030 0%, #0a0505 70%)',
    },
    {
      chapter: '1519',
      title: 'Montañas flotantes',
      text: `Y entonces llegaron. Sobre el horizonte aparecieron «casas flotantes» con velas blancas. De ellas bajaron hombres cubiertos de metal, montados sobre bestias jamás vistas, portando truenos que mataban a distancia. Algunos los creyeron dioses. Estaban equivocados.`,
      bg: 'radial-gradient(ellipse at 50% 60%, #20486a 0%, #050a12 70%)',
    },
    {
      chapter: 'El precio',
      title: 'Oro, fuego y plaga',
      text: `Buscaban oro con un hambre que nada saciaba. Forjaron alianzas con pueblos sometidos, sembraron la traición y, tras ellos, una plaga invisible diezmó a millones. El acero y la pólvora hicieron el resto. Un imperio milenario tambaleó en meses.`,
      bg: 'radial-gradient(ellipse at 50% 50%, #6a2810 0%, #0a0503 70%)',
    },
    {
      chapter: 'Tu destino',
      title: 'La historia no está escrita',
      text: `Pero esta vez, el mando es tuyo. Reúne a tus guerreros, fortifica tus ciudades y enfrenta a los invasores. ¿Repetirás la caída... o cambiarás para siempre el destino de América?`,
      bg: 'radial-gradient(ellipse at 50% 40%, #1a5c2a 0%, #04100a 70%)',
    },
  ];
}

function conquistadorBeats(): Beat[] {
  return [
    {
      chapter: 'Año 1519 · Cuba',
      title: 'Hambre de gloria',
      text: `Europa hervía de ambición. Más allá del océano, según los rumores, aguardaban reinos de oro. Hernán Cortés, con apenas quinientos hombres, dieciséis caballos y unos pocos cañones, zarpó hacia lo desconocido en busca de fortuna, fe y gloria eterna.`,
      bg: 'radial-gradient(ellipse at 50% 30%, #2a3a5a 0%, #05080f 70%)',
    },
    {
      chapter: 'Veracruz',
      title: 'Quemar las naves',
      text: `Al pisar tierra firme, Cortés hizo lo impensable: ordenó hundir sus propios barcos. No habría retirada. Adelante o la muerte. Ante ellos se extendía un continente entero, habitado por imperios cuyo poder y riqueza superaban toda imaginación.`,
      bg: 'radial-gradient(ellipse at 50% 55%, #5a3a18 0%, #0a0703 70%)',
    },
    {
      chapter: 'La marcha',
      title: 'Aliados y enemigos',
      text: `Tierra adentro, los conquistadores descubrieron que el gran imperio tenía muchos enemigos. Pueblos sometidos y hartos del tributo se unieron a los extranjeros. Con cada alianza, el puñado de soldados se convertía en un ejército imparable.`,
      bg: 'radial-gradient(ellipse at 50% 45%, #3a5a20 0%, #060f04 70%)',
    },
    {
      chapter: 'El premio',
      title: 'Ciudades de oro',
      text: `Y por fin la vieron: ciudades sobre el agua, templos que rivalizaban con los de Europa, plazas que brillaban de oro y plumas. La codicia se encendió como fuego seco. Lo que siguió cambiaría la faz del mundo para siempre.`,
      bg: 'radial-gradient(ellipse at 50% 35%, #6a5010 0%, #0a0803 70%)',
    },
    {
      chapter: 'Tu destino',
      title: 'Conquistar un continente',
      text: `Ahora tú llevas el estandarte. Con unos pocos hombres y una determinación de hierro, deberás someter a un mundo entero. ¿Tienes el temple para escribir tu nombre en la historia con sangre y oro?`,
      bg: 'radial-gradient(ellipse at 50% 40%, #7a1818 0%, #100303 70%)',
    },
  ];
}

const NATIVE_FLAVOR: Record<CivilizationType, { name: string; home: string; year: string; omen: string }> = {
  [CivilizationType.AZTEC]: {
    name: 'el Imperio Mexica',
    home: 'Tenochtitlán, corazón del lago',
    year: '1502 · Coronación de Moctezuma II',
    omen: 'Un cometa rasgó el cielo nocturno y el templo de Huitzilopochtli ardió sin causa.',
  },
  [CivilizationType.INCA]: {
    name: 'el Tawantinsuyu',
    home: 'Cusco, ombligo del mundo',
    year: '1525 · El imperio en su cénit',
    omen: 'Una guerra entre hermanos por el trono desangraba al imperio; los augures vieron condores caer del cielo.',
  },
  [CivilizationType.MAYA]: {
    name: 'las ciudades mayas',
    home: 'las selvas de Yucatán',
    year: '1517 · Primeros velámenes en la costa',
    omen: 'Los códices hablaban del fin de un ciclo; el cielo y la tierra parecían contener el aliento.',
  },
  [CivilizationType.CONQUISTADOR]: { name: '', home: '', year: '', omen: '' },
};

export class NarrativeScreen {
  private el: HTMLElement;
  private chapterEl: HTMLElement;
  private titleEl: HTMLElement;
  private textEl: HTMLElement;
  private dotsEl: HTMLElement;
  private bgEl: HTMLElement;
  private nextBtn: HTMLButtonElement;
  private skipBtn: HTMLButtonElement;

  private beats: Beat[] = [];
  private index = 0;
  private onDone: (() => void) | null = null;

  constructor() {
    this.el        = document.getElementById('narrative-screen')!;
    this.chapterEl = document.getElementById('narr-chapter')!;
    this.titleEl   = document.getElementById('narr-title')!;
    this.textEl    = document.getElementById('narr-text')!;
    this.dotsEl    = document.getElementById('narr-dots')!;
    this.bgEl      = this.el.querySelector('.narr-bg') as HTMLElement;
    this.nextBtn   = document.getElementById('narr-next') as HTMLButtonElement;
    this.skipBtn   = document.getElementById('narr-skip') as HTMLButtonElement;

    this.nextBtn.addEventListener('click', () => this.advance());
    this.skipBtn.addEventListener('click', () => this.finish());
  }

  play(civ: CivilizationType, onDone: () => void) {
    this.onDone = onDone;
    this.beats = civ === CivilizationType.CONQUISTADOR
      ? conquistadorBeats()
      : (() => { const f = NATIVE_FLAVOR[civ]; return nativeBeats(f.name, f.home, f.year, f.omen); })();
    this.index = 0;
    this.el.classList.remove('hidden');
    this.render();
  }

  private render() {
    const beat = this.beats[this.index];
    this.bgEl.style.background = beat.bg;
    this.chapterEl.textContent = beat.chapter;
    this.titleEl.textContent   = beat.title;
    this.textEl.textContent    = beat.text;

    // re-trigger fade-in animation
    const c = this.el.querySelector('.narr-content') as HTMLElement;
    c.classList.remove('narr-in'); void c.offsetWidth; c.classList.add('narr-in');

    this.dotsEl.textContent = this.beats.map((_, i) => i === this.index ? '●' : '○').join(' ');
    this.nextBtn.textContent = this.index === this.beats.length - 1 ? '⚔️  Comenzar' : 'Continuar ▶';
  }

  private advance() {
    if (this.index < this.beats.length - 1) {
      this.index++;
      this.render();
    } else {
      this.finish();
    }
  }

  private finish() {
    this.el.classList.add('hidden');
    const cb = this.onDone;
    this.onDone = null;
    cb?.();
  }
}
