/** Tipos de las respuestas de la Graph API que consumimos (solo lo usado). */

export interface FbTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

export interface IgTokenResponse {
  access_token: string;
  user_id?: string | number;
  permissions?: string[] | string;
}

export interface IgLongLivedTokenResponse {
  access_token: string;
  token_type?: string;
  /** segundos (~60 días) */
  expires_in: number;
}

export interface IgMeResponse {
  id?: string;
  user_id?: string | number;
  username: string;
  name?: string;
  account_type?: string;
  profile_picture_url?: string;
}

export interface FbPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: {
    id: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
  };
}

export interface FbPagesResponse {
  data: FbPage[];
}

export interface IgUserProfile {
  name?: string;
  username?: string;
  profile_pic?: string;
  is_verified_user?: boolean;
  follower_count?: number;
  is_user_follow_business?: boolean;
}

export class MetaApiError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly fbCode: number | undefined,
    public readonly fbSubcode: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'MetaApiError';
  }

  /** error 190 = token inválido/revocado. */
  get isTokenInvalid(): boolean {
    return this.fbCode === 190;
  }
}
