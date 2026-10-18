import React, { useEffect, useState } from 'react';
import { Activity, CirclePlus, Feather, Hand } from 'lucide-react';
import type { RacketGearItem } from '../types/equipment';
import type {
  AddRacketPayload,
  AddShuttleTubePayload,
  GripChangePayload,
  RestringPayload,
} from '../utils/equipmentActions';
import { getRacketLabel } from '../utils/equipmentActions';
import { Button } from './ui/Button';
import { StyledInput, StyledSelect } from './ui/FormControls';
import { Modal } from './ui/Modal';

const TENSION_OPTIONS = [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
const DEFAULT_TENSION_LBS = 27;
const DEFAULT_GAUGE_MM = 0.66;
const DEFAULT_GRIP_MODEL = 'Yonex Super Grap';

function racketOptionLabel(racket: RacketGearItem): string {
  const fullModel = `${racket.brand} ${racket.model}`.trim();
  return racket.nickname && racket.nickname !== racket.model
    ? `${racket.nickname} (${racket.model})`
    : fullModel || getRacketLabel(racket);
}

const TensionSelect: React.FC<{
  id: string;
  value: number;
  onChange: (lbs: number) => void;
}> = ({ id, value, onChange }) => (
  <StyledSelect
    id={id}
    label="Tension"
    value={value}
    onChange={(e) => onChange(Number(e.target.value))}
  >
    {TENSION_OPTIONS.map((lbs) => (
      <option key={lbs} value={lbs}>
        {`${lbs} lbs`}
      </option>
    ))}
  </StyledSelect>
);

const RacketSelect: React.FC<{
  id: string;
  rackets: RacketGearItem[];
  value: string;
  onChange: (racketId: string) => void;
}> = ({ id, rackets, value, onChange }) => (
  <StyledSelect
    id={id}
    label="Racket"
    value={value}
    onChange={(e) => onChange(e.target.value)}
  >
    {rackets.map((r) => (
      <option key={r.id} value={r.id}>
        {racketOptionLabel(r)}
      </option>
    ))}
  </StyledSelect>
);

const FormError: React.FC<{ message: string }> = ({ message }) =>
  message ? (
    <p className="text-xs text-rose-600 font-medium" role="alert">
      {message}
    </p>
  ) : null;

const ModalActions: React.FC<{ onCancel: () => void; submitLabel: string }> = ({
  onCancel,
  submitLabel,
}) => (
  <>
    <Button onClick={onCancel}>Cancel</Button>
    <Button type="submit" variant="primary">
      {submitLabel}
    </Button>
  </>
);

interface RestringModalProps {
  isOpen: boolean;
  today: string;
  rackets: RacketGearItem[];
  defaultRacketId: string;
  defaultStringModel?: string;
  defaultTensionLbs?: number;
  onClose: () => void;
  onSubmit: (payload: RestringPayload) => void;
}

export const RestringModal: React.FC<RestringModalProps> = ({
  isOpen,
  today,
  rackets,
  defaultRacketId,
  defaultStringModel = '',
  defaultTensionLbs = DEFAULT_TENSION_LBS,
  onClose,
  onSubmit,
}) => {
  const [racketId, setRacketId] = useState(defaultRacketId);
  const [stringModel, setStringModel] = useState(defaultStringModel);
  const [tensionLbs, setTensionLbs] = useState(defaultTensionLbs);
  const [strungAtDate, setStrungAtDate] = useState(today);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setRacketId(defaultRacketId);
    setStringModel(defaultStringModel);
    setTensionLbs(defaultTensionLbs);
    setStrungAtDate(today);
    setErrorMsg('');
  }, [isOpen, defaultRacketId, defaultStringModel, defaultTensionLbs, today]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedString = stringModel.trim();
    if (!racketId) return;
    if (!trimmedString) {
      setErrorMsg('Type the string that was installed.');
      return;
    }
    onSubmit({
      racketId,
      stringModel: trimmedString,
      gaugeMm: DEFAULT_GAUGE_MM,
      mainTensionLbs: tensionLbs,
      crossTensionLbs: tensionLbs,
      strungAtDate: strungAtDate || today,
    });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Log Restring"
      icon={<Activity className="w-4 h-4" />}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={<ModalActions onCancel={onClose} submitLabel="Save Restring" />}
    >
      <RacketSelect
        id="restring-racket"
        rackets={rackets}
        value={racketId}
        onChange={setRacketId}
      />
      <StyledInput
        id="restring-string-input"
        label="Installed string"
        value={stringModel}
        onChange={(e) => {
          setStringModel(e.target.value);
          if (errorMsg) setErrorMsg('');
        }}
        placeholder="e.g. Yonex Exbolt 65 or BG80"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TensionSelect id="restring-tension" value={tensionLbs} onChange={setTensionLbs} />
        <StyledInput
          id="restring-date-input"
          label="Restring date"
          type="date"
          max={today}
          value={strungAtDate}
          onChange={(e) => setStrungAtDate(e.target.value)}
        />
      </div>
      <FormError message={errorMsg} />
    </Modal>
  );
};

interface ChangeGripModalProps {
  isOpen: boolean;
  today: string;
  rackets: RacketGearItem[];
  defaultRacketId: string;
  defaultGripBrandModel?: string;
  onClose: () => void;
  onSubmit: (payload: GripChangePayload) => void;
}

export const ChangeGripModal: React.FC<ChangeGripModalProps> = ({
  isOpen,
  today,
  rackets,
  defaultRacketId,
  defaultGripBrandModel = DEFAULT_GRIP_MODEL,
  onClose,
  onSubmit,
}) => {
  const [racketId, setRacketId] = useState(defaultRacketId);
  const [gripBrandModel, setGripBrandModel] = useState(defaultGripBrandModel);
  const [wrappedAtDate, setWrappedAtDate] = useState(today);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setRacketId(defaultRacketId);
    setGripBrandModel(defaultGripBrandModel);
    setWrappedAtDate(today);
    setErrorMsg('');
  }, [isOpen, defaultRacketId, defaultGripBrandModel, today]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedGrip = gripBrandModel.trim();
    if (!racketId) return;
    if (!trimmedGrip) {
      setErrorMsg('Type the grip brand or model.');
      return;
    }
    onSubmit({
      racketId,
      gripBrandModel: trimmedGrip,
      wrappedAtDate: wrappedAtDate || today,
    });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Change Grip"
      icon={<Hand className="w-4 h-4" />}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={<ModalActions onCancel={onClose} submitLabel="Save Grip" />}
    >
      <RacketSelect
        id="grip-modal-racket"
        rackets={rackets}
        value={racketId}
        onChange={setRacketId}
      />
      <StyledInput
        id="grip-modal-model-input"
        label="Installed grip"
        value={gripBrandModel}
        onChange={(e) => {
          setGripBrandModel(e.target.value);
          if (errorMsg) setErrorMsg('');
        }}
        placeholder="e.g. Yonex Super Grap (White) or Victor Towel Grip"
      />
      <StyledInput
        id="grip-modal-date-input"
        label="Wrap date"
        type="date"
        max={today}
        value={wrappedAtDate}
        onChange={(e) => setWrappedAtDate(e.target.value)}
      />
      <FormError message={errorMsg} />
    </Modal>
  );
};

interface AddRacketModalProps {
  isOpen: boolean;
  today: string;
  onClose: () => void;
  onAddRacket: (payload: AddRacketPayload) => void;
}

export const AddRacketModal: React.FC<AddRacketModalProps> = ({
  isOpen,
  today,
  onClose,
  onAddRacket,
}) => {
  const [racketModel, setRacketModel] = useState('');
  const [nickname, setNickname] = useState('');
  const [installedString, setInstalledString] = useState('');
  const [installedGrip, setInstalledGrip] = useState(DEFAULT_GRIP_MODEL);
  const [tensionLbs, setTensionLbs] = useState(DEFAULT_TENSION_LBS);
  const [strungAtDate, setStrungAtDate] = useState(today);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setRacketModel('');
    setNickname('');
    setInstalledString('');
    setInstalledGrip(DEFAULT_GRIP_MODEL);
    setTensionLbs(DEFAULT_TENSION_LBS);
    setStrungAtDate(today);
    setErrorMsg('');
  }, [isOpen, today]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedModel = racketModel.trim();
    const trimmedString = installedString.trim();
    if (!trimmedModel) {
      setErrorMsg('Type the racket model.');
      return;
    }
    if (!trimmedString) {
      setErrorMsg('Type the string that is installed.');
      return;
    }
    onAddRacket({
      nickname: nickname.trim() || trimmedModel,
      brand: '',
      model: trimmedModel,
      initialStringModel: trimmedString,
      initialGaugeMm: DEFAULT_GAUGE_MM,
      initialMainLbs: tensionLbs,
      initialCrossLbs: tensionLbs,
      strungAtDate: strungAtDate || today,
      gripBrandModel: installedGrip.trim() || DEFAULT_GRIP_MODEL,
    });
    onClose();
  };

  const clearError = () => {
    if (errorMsg) setErrorMsg('');
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Add Racket"
      icon={<CirclePlus className="w-4 h-4" />}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={<ModalActions onCancel={onClose} submitLabel="Add Racket" />}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <StyledInput
          id="racket-model-input"
          label="Racket model"
          value={racketModel}
          onChange={(e) => {
            setRacketModel(e.target.value);
            clearError();
          }}
          placeholder="e.g. Yonex Astrox 88D Pro"
        />
        <StyledInput
          id="racket-custom-label"
          label="Nickname"
          hint="Optional"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="e.g. Doubles #1"
        />
        <StyledInput
          id="racket-string-input"
          label="Installed string"
          value={installedString}
          onChange={(e) => {
            setInstalledString(e.target.value);
            clearError();
          }}
          placeholder="e.g. Yonex Exbolt 65"
        />
        <StyledInput
          id="racket-grip-input"
          label="Installed grip"
          value={installedGrip}
          onChange={(e) => setInstalledGrip(e.target.value)}
          placeholder="e.g. Yonex Super Grap"
        />
        <TensionSelect id="racket-tension" value={tensionLbs} onChange={setTensionLbs} />
        <StyledInput
          id="racket-strung-date"
          label="Strung & wrapped on"
          type="date"
          max={today}
          value={strungAtDate}
          onChange={(e) => setStrungAtDate(e.target.value)}
        />
      </div>
      <FormError message={errorMsg} />
    </Modal>
  );
};

interface AddShuttleTubeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddTube: (payload: AddShuttleTubePayload) => void;
}

export const AddShuttleTubeModal: React.FC<AddShuttleTubeModalProps> = ({
  isOpen,
  onClose,
  onAddTube,
}) => {
  const [brandModel, setBrandModel] = useState('');
  const [shuttleCountText, setShuttleCountText] = useState('12');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setBrandModel('');
    setShuttleCountText('12');
    setErrorMsg('');
  }, [isOpen]);

  const shuttleCount = Number.parseInt(shuttleCountText, 10);
  const isCountValid = Number.isInteger(shuttleCount) && shuttleCount >= 1 && shuttleCount <= 24;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = brandModel.trim();
    if (!trimmed) {
      setErrorMsg('Type the shuttle brand or model.');
      return;
    }
    if (!isCountValid) {
      setErrorMsg('Shuttles per tube must be a whole number from 1 to 24.');
      return;
    }
    onAddTube({ brandModel: trimmed, shuttleCount });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Add Shuttle Tube"
      icon={<Feather className="w-4 h-4" />}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <ModalActions
          onCancel={onClose}
          submitLabel={isCountValid ? `Add Tube (${shuttleCount})` : 'Add Tube'}
        />
      }
    >
      <StyledInput
        id="shuttle-tube-description"
        label="Shuttle brand or model"
        value={brandModel}
        onChange={(e) => {
          setBrandModel(e.target.value);
          if (errorMsg) setErrorMsg('');
        }}
        placeholder="e.g. Yonex AS-50 or RSL Classic"
      />
      <StyledInput
        id="shuttle-tube-quantity"
        label="Shuttles per tube"
        type="number"
        inputMode="numeric"
        min={1}
        max={24}
        value={shuttleCountText}
        onChange={(e) => {
          setShuttleCountText(e.target.value);
          if (errorMsg) setErrorMsg('');
        }}
        className="font-mono tabular-nums"
      />
      <FormError message={errorMsg} />
    </Modal>
  );
};
