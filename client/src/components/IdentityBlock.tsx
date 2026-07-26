import type { Profile } from "../../../shared/types.js";

export function IdentityBlock({ profile }: { profile: Profile }) {
  return (
    <div className="identity-block">
      <h1 className="identity-block__name">{profile.name}</h1>
      <p className="identity-block__bio">{profile.bio}</p>
      <div className="identity-block__currently">
        {profile.currently.reading && <span>reading {profile.currently.reading}</span>}
        {profile.currently.into && <span>into {profile.currently.into}</span>}
        {profile.currently.location && <span>{profile.currently.location}</span>}
      </div>
    </div>
  );
}
