import { useCallback } from "react";
import { getEntries, getProfile } from "../api/client.js";
import { useFetch } from "../hooks/useFetch.js";
import { IdentityBlock } from "../components/IdentityBlock.js";
import { ChapterList } from "../components/ChapterList.js";

export function ProfilePage() {
  const load = useCallback(
    () => Promise.all([getProfile(), getEntries()]),
    [],
  );
  const { loading, data, error } = useFetch(load, []);

  if (loading) return null;
  if (error) return <p>Couldn't load your profile: {error.message}</p>;
  if (!data) return null;

  const [profile, entries] = data;
  return (
    <>
      <IdentityBlock profile={profile} />
      <ChapterList entries={entries} />
    </>
  );
}
