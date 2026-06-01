export type IclinicCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
};

/** Persistido em `company_platforms.config` (slug iclinic). */
export type IclinicCompanyConfig = {
  email?: string;
  password?: string;
  token?: string;
  token_source?: string;
  clinic_id?: string;
  sessionid?: string | null;
  next_auth_session_token_v2?: string | null;
  cookies?: IclinicCookie[];
  token_updated_at?: string;
};

export type IclinicSession = {
  token: string;
  tokenSource?: string;
  clinicId: string;
  cookies: IclinicCookie[];
};

export type IclinicAgendaPatient = {
  id: number;
  code?: number;
  name?: string;
  home_phone?: string | null;
  birth_date?: string | null;
  age?: number;
  gender?: string | null;
  mobile_phone?: string | null;
  email?: string | null;
  picture?: string | null;
  last_appointment_date?: string | null;
  age_full_described?: string | null;
};

export type IclinicAgendaProcedure = {
  id: number;
  name: string;
  value: number;
  quantity: number;
};

export type IclinicFormattedEvent = {
  id: number;
  patient: IclinicAgendaPatient;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  description?: string | null;
  added_by?: string | null;
  date_added?: string | null;
  patient_email?: string | null;
  insurance?: string | null;
  procedures: IclinicAgendaProcedure[];
  pay_date?: string | null;
  value?: number | null;
};
