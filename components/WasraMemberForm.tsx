"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Club = {
  id: number;
  club_name: string;
};

type Props = {
  onCancel: () => void;
  onCompleted: () => void | Promise<void>;
};

export default function WasraMemberForm({
  onCancel,
  onCompleted,
}: Props) {
  const [wasraNumber, setWasraNumber] = useState("");
  const [firstName, setFirstName] = useState("");
  const [surname, setSurname] = useState("");
  const [firearmsAuthority, setFirearmsAuthority] = useState("");
  const [membershipType, setMembershipType] = useState("Senior");

  const [clubs, setClubs] = useState<Club[]>([]);
  const [club, setClub] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadClubs() {
      const supabase = createClient();

      const { data, error } = await supabase
        .from("clubs")
        .select("id, club_name")
        .order("club_name");

      if (error) {
        setError(error.message);
        return;
      }

      const clubData = (data ?? []) as Club[];

      setClubs(clubData);

      const waspsClub = clubData.find(
        (c) => c.club_name.toUpperCase() === "WASPS"
      );

      if (waspsClub) {
        setClub(waspsClub.club_name);
      } else if (clubData.length > 0) {
        setClub(clubData[0].club_name);
      }
    }

    void loadClubs();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setBusy(true);
    setError("");

    try {
      const supabase = createClient();

      const { error: insertError } = await supabase
        .from("members")
        .insert({
          wasra_number: Number(wasraNumber),
          first_name: firstName.trim(),
          surname: surname.trim(),
          firearms_authority: firearmsAuthority.trim(),
          membership_type: membershipType,
          club,
          is_active: true,
          is_junior: membershipType === "Junior",
          can_be_official: true,
        });

      if (insertError) {
        throw insertError;
      }

      await onCompleted();
    } catch (err: any) {
      setError(err.message ?? "Unable to add member");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="result info">
      <div className="result-title">
        ADD MEMBER
      </div>

      <form onSubmit={handleSubmit}>
        <input
          className="scan-input"
          type="number"
          placeholder="WASRA Number"
          value={wasraNumber}
          onChange={(e) => setWasraNumber(e.target.value)}
          required
        />

        <input
          className="scan-input"
          type="text"
          placeholder="First Name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          required
        />

        <input
          className="scan-input"
          type="text"
          placeholder="Surname"
          value={surname}
          onChange={(e) => setSurname(e.target.value)}
          required
        />

        <input
          className="scan-input"
          type="text"
          placeholder="Firearms Authority Number"
          value={firearmsAuthority}
          onChange={(e) => setFirearmsAuthority(e.target.value)}
          required
        />

        <select
          className="scan-input"
          value={membershipType}
          onChange={(e) => setMembershipType(e.target.value)}
        >
          <option value="Senior">Senior</option>
          <option value="Junior">Junior</option>
          <option value="Associate">Associate</option>
          <option value="Life">Life</option>
        </select>

        <select
          className="scan-input"
          value={club}
          onChange={(e) => setClub(e.target.value)}
          required
        >
          <option value="">Select Club</option>

          {clubs.map((clubRow) => (
            <option
              key={clubRow.id}
              value={clubRow.club_name}
            >
              {clubRow.club_name}
            </option>
          ))}
        </select>

        {error && (
          <div className="result error">
            <p>{error}</p>
          </div>
        )}

        <div className="actions">
          <button
            type="submit"
            className="primary"
            disabled={busy}
          >
            {busy ? "Saving..." : "Save Member"}
          </button>

          <button
            type="button"
            className="secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
