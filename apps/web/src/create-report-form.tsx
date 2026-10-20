import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  EXTRA_MAX_LENGTH, LITTER_MAX_LENGTH,
  type City, type CreateReportDto, type DbImage, type Quarter, type Report, type StorageMetadata,
} from '../../../libs/contracts/src';
import { createReport, uploadPhoto, validatePhoto } from './client';

interface Props {
  storage: StorageMetadata;
  cities: City[];
  quarters: Quarter[];
  onCreated: (report: Report) => void;
}

type Field = 'cityId' | 'quarterId' | 'latitude' | 'longitude' | 'locationType' | 'litterType' | 'extra';
type Errors = Partial<Record<Field, string>>;
const initialValues = {
  cityId: '9000', quarterId: '', latitude: '', longitude: '',
  locationType: 'water', litterType: '', extra: '',
};

export function CreateReportForm({ cities, quarters, onCreated, storage }: Props) {
  const demo = storage.mode === 'demo';
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState('');
  const [pending, setPending] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const confirmedUpload = useRef<DbImage | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const summary = useRef<HTMLDivElement>(null);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!photo || validatePhoto(photo)) { setPreview(''); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function change(field: Field, value: string) {
    setValues((previous) => ({
      ...previous, [field]: value, ...(field === 'cityId' ? { quarterId: '' } : {}),
    }));
    setSuccess('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    if (photo && (!demo || validatePhoto(photo))) {
      setMessage(demo ? validatePhoto(photo)! : 'Foto’s zijn alleen in demo-modus beschikbaar.');
      return;
    }
    const nextErrors: Errors = {};
    const cityId = Number(values.cityId);
    const quarterId = values.quarterId === '' ? null : Number(values.quarterId);
    const latitude = Number(values.latitude);
    const longitude = Number(values.longitude);
    if (!cities.some((city) => city.id === cityId)) nextErrors.cityId = 'Kies een bekende stad.';
    if (quarterId !== null && !quarters.some((quarter) => quarter.id === quarterId && quarter.cityId === cityId)) {
      nextErrors.quarterId = 'Kies een wijk die bij de stad hoort.';
    }
    if (values.latitude.trim() === '' || !Number.isFinite(latitude) || Math.abs(latitude) > 90) {
      nextErrors.latitude = 'Vul een breedtegraad tussen -90 en 90 in.';
    }
    if (values.longitude.trim() === '' || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      nextErrors.longitude = 'Vul een lengtegraad tussen -180 en 180 in.';
    }
    if (!['water', 'land'].includes(values.locationType)) nextErrors.locationType = 'Kies water of land.';
    if (!values.litterType.trim() || values.litterType.length > LITTER_MAX_LENGTH) {
      nextErrors.litterType = 'Vul een afvalsoort van 1 tot 80 tekens in.';
    }
    if (values.extra.length > EXTRA_MAX_LENGTH) nextErrors.extra = 'Gebruik maximaal 364 tekens.';
    setErrors(nextErrors);
    setSuccess('');
    if (Object.keys(nextErrors).length > 0) {
      setMessage(confirmedUpload.current
        ? 'Controleer de velden hieronder. Geen nieuwe melding verstuurd. De foto is al opgeslagen en niet teruggedraaid.'
        : 'Controleer de velden hieronder. Er is nog niets verstuurd.');
      queueMicrotask(() => summary.current?.focus());
      return;
    }
    const input: CreateReportDto = {
      cityId, quarterId, latLngTuple: [latitude, longitude],
      locationType: values.locationType, litterType: values.litterType.trim(),
      extra: values.extra || null,
    };
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setMessage('');
    try {
      if (photo && !confirmedUpload.current) confirmedUpload.current = await uploadPhoto(photo, controller.signal);
      if (controller.signal.aborted) return;
      if (demo && photo && confirmedUpload.current) input.dbImageId = confirmedUpload.current.id;
      const report = await createReport(input, controller.signal);
      if (controller.signal.aborted) return;
      setSuccess(`${demo ? 'Demo-melding' : 'Melding'} #${report.id} ${demo ? 'toegevoegd aan het tijdelijke geheugen' : 'opgeslagen in PostgreSQL'}. De lijst en kaart worden vernieuwd; je filters volgen de nieuwe melding.`);
      setValues((previous) => ({ ...previous, latitude: '', longitude: '', litterType: '', extra: '' }));
      setPhoto(null);
      confirmedUpload.current = null;
      if (picker.current) picker.current.value = '';
      onCreated(report);
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        setMessage((error instanceof Error ? error.message : 'Geen bevestiging ontvangen. Controleer de lijst voordat je opnieuw verstuurt.') +
          (confirmedUpload.current ? ' De foto is al opgeslagen, niet teruggedraaid. Bij opnieuw versturen gebruiken we dezelfde foto.' : ''));
        queueMicrotask(() => summary.current?.focus());
      }
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setPending(false);
      }
    }
  }

  function errorProps(field: Field) {
    return {
      id: `create-${field}`,
      'aria-invalid': errors[field] ? true : undefined,
      'aria-describedby': errors[field] ? `create-${field}-error` : undefined,
    };
  }

  function fieldError(field: Field) {
    return errors[field] && <span className="field-error" id={`create-${field}-error`}>{errors[field]}</span>;
  }

  return (
    <section className="create-panel" aria-labelledby="create-title">
      <div className="create-heading">
        <div><p className="eyebrow">PROBEER HET ZELF</p><h2 id="create-title">{demo ? 'Nieuwe demo-melding' : 'Nieuwe melding'}</h2></div>
        <span className="demo-badge">{demo ? 'Tijdelijk · geen echte melding' : 'PostgreSQL · blijvende opslag'}</span>
      </div>
      <p id="create-disclosure">{demo
        ? 'Alleen verzonnen gegevens en synthetische foto’s: meldingen en foto’s verdwijnen bij herstart. Geen database of account. Foto’s zijn openbaar binnen deze lokale demo. Maximaal 10 opgeslagen foto’s per proces, ook ongekoppelde uploads; geen automatische opruiming. Eén foto per melding; dezelfde upload mag bij meerdere meldingen horen. Alleen bestandssignatuurcontrole, geen volledige beeld- of malwarevalidatie.'
        : 'Meldingen worden opgeslagen in PostgreSQL en verdwijnen niet bij herstart. Geen foto of account. Nog niet goedgekeurd voor productie.'}
        {' '}Maximaal 5 pogingen per minuut voor iedereen samen en 100 nieuwe meldingen per proces. Dit is geen productiebeveiliging.</p>
      <form onSubmit={submit} noValidate aria-labelledby="create-title" aria-describedby="create-disclosure" aria-busy={pending}>
        {message && (
          <div className="error-panel" role="alert" tabIndex={-1} ref={summary}>
            <strong>{demo ? 'Controleer je demo-melding' : 'Controleer je melding'}</strong><p>{message}</p>
            <ul>{Object.entries(errors).map(([field, error]) => (
              <li key={field}><a href={`#create-${field}`}>{error}</a></li>
            ))}</ul>
          </div>
        )}
        <fieldset disabled={pending}>
          <legend className="sr-only">{demo ? 'Gegevens van de nieuwe demo-melding' : 'Gegevens van de nieuwe melding'}</legend>
          <div className="create-grid">
            {demo && <div className="create-field create-extra">
              <label htmlFor="create-photo">Foto (optioneel, JPEG, PNG of WebP)</label>
              <input id="create-photo" ref={picker} type="file" accept="image/jpeg,image/png,image/webp"
                aria-describedby="create-photo-help" aria-invalid={photo && validatePhoto(photo) ? true : undefined}
                onChange={(event) => {
                  setPhoto(event.target.files?.[0] ?? null);
                  confirmedUpload.current = null;
                  setSuccess('');
                }} />
              <span id="create-photo-help">Maximaal 5.000.000 bytes. Upload gebeurt pas bij versturen. Een vervangen foto blijft tot herstart opgeslagen.</span>
              {photo && validatePhoto(photo) && <span role="alert" className="field-error">{validatePhoto(photo)}</span>}
              {preview && <img className="report-photo" src={preview} alt="Voorbeeld van de gekozen demo-foto" />}
            </div>}
            <div className="create-field"><label htmlFor="create-cityId">Stad van melding</label>
              <select {...errorProps('cityId')} value={values.cityId} onChange={(event) => change('cityId', event.target.value)}>
                {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
              </select>{fieldError('cityId')}
            </div>
            <div className="create-field"><label htmlFor="create-quarterId">Wijk van melding (optioneel)</label>
              <select {...errorProps('quarterId')} value={values.quarterId} onChange={(event) => change('quarterId', event.target.value)}>
                <option value="">Niet opgegeven</option>
                {quarters.filter((quarter) => quarter.cityId === Number(values.cityId)).map((quarter) => (
                  <option key={quarter.id} value={quarter.id}>{quarter.quarter}</option>
                ))}
              </select>{fieldError('quarterId')}
            </div>
            <div className="create-field"><label htmlFor="create-latitude">Breedtegraad</label>
              <input {...errorProps('latitude')} type="number" step="any" min="-90" max="90" required
                placeholder="Bijv. 51.0543" value={values.latitude} onChange={(event) => change('latitude', event.target.value)} />
              {fieldError('latitude')}
            </div>
            <div className="create-field"><label htmlFor="create-longitude">Lengtegraad</label>
              <input {...errorProps('longitude')} type="number" step="any" min="-180" max="180" required
                placeholder="Bijv. 3.7206" value={values.longitude} onChange={(event) => change('longitude', event.target.value)} />
              {fieldError('longitude')}
            </div>
            <div className="create-field"><label htmlFor="create-locationType">Waar ligt het afval?</label>
              <select {...errorProps('locationType')} value={values.locationType} onChange={(event) => change('locationType', event.target.value)}>
                <option value="water">In het water</option><option value="land">Op het land</option>
              </select>{fieldError('locationType')}
            </div>
            <div className="create-field"><label htmlFor="create-litterType">Afvalsoort</label>
              <input {...errorProps('litterType')} required maxLength={LITTER_MAX_LENGTH}
                placeholder="Bijv. plastic flessen" value={values.litterType} onChange={(event) => change('litterType', event.target.value)} />
              {fieldError('litterType')}
            </div>
            <div className="create-field create-extra"><label htmlFor="create-extra">Extra informatie (optioneel)</label>
              <textarea {...errorProps('extra')} maxLength={EXTRA_MAX_LENGTH} rows={3}
                value={values.extra} onChange={(event) => change('extra', event.target.value)} />
              <span>{values.extra.length} / {EXTRA_MAX_LENGTH} tekens</span>{fieldError('extra')}
            </div>
          </div>
        </fieldset>
        <div className="create-actions">
          <button type="submit" disabled={pending}>{demo
            ? pending ? 'Demo-melding versturen…' : 'Demo-melding toevoegen'
            : pending ? 'Melding versturen…' : 'Melding toevoegen'}</button>
          <span>Geen automatische herhaling bij een verbindingsfout.</span>
        </div>
        <p role="status" className="create-status">{pending
          ? demo ? 'Even geduld, je demo-melding wordt verstuurd…' : 'Even geduld, je melding wordt verstuurd…'
          : success}</p>
      </form>
    </section>
  );
}
