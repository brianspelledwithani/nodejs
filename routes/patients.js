const express = require("express");
const router = express.Router();
const { pool } = require("./db");

/**
 * Treatment labels coming from the React UI (strings in suggestedTreatments[])
 * We map these to boolean columns in Postgres.
 */
const TREATMENT_LABELS = {
  CBTI: "Cognitive Behavioral Therapy for Insomnia",
  CPAP_COMISA:
    "CPAP Compliance Program for COMISA (Co-morbid Insomnia with Sleep Apnea)",
  SLEEP_EEG: "Sleep EEG for Insomnia",
  ZEPBOUND_OSA: "Zepbound Rx for OSA",
  NATURAL_PRODUCTS: "Natural Products for Insomnia",
  INSOMNIA_MEDS_MGMT:
    "Insomnia Medications Management* (help patients treat insomnia without addictive medications)",
};

function treatmentsToFlags(suggestedTreatments) {
  const treatments = Array.isArray(suggestedTreatments) ? suggestedTreatments : [];

  return {
    tx_cbti: treatments.includes(TREATMENT_LABELS.CBTI),
    tx_cpap_comisa: treatments.includes(TREATMENT_LABELS.CPAP_COMISA),
    tx_sleep_eeg: treatments.includes(TREATMENT_LABELS.SLEEP_EEG),
    tx_zepbound_osa: treatments.includes(TREATMENT_LABELS.ZEPBOUND_OSA),
    tx_natural_products: treatments.includes(TREATMENT_LABELS.NATURAL_PRODUCTS),
    tx_insomnia_meds_mgmt: treatments.includes(TREATMENT_LABELS.INSOMNIA_MEDS_MGMT),
  };
}

function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
}

function normalizePracticeName(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * POST /api/patients
 * Logged-in flow later. For now expects provider_id in request body.
 * NOTE: If you are transitioning provider_id to mean Healthie provider id, this still works.
 */
router.post("/", async (req, res) => {
  try {
    const {
      provider_id,
      name,
      dateOfBirth,
      mobile,
      email,
      isiScore,
      suggestedTreatments = [],
    } = req.body || {};

    if (!provider_id) return res.status(400).json({ error: "provider_id is required" });
    if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
    if (!dateOfBirth) return res.status(400).json({ error: "dateOfBirth is required" });
    if (!mobile || !mobile.trim()) return res.status(400).json({ error: "mobile is required" });

    const isi =
      isiScore === "" || isiScore === null || isiScore === undefined
        ? null
        : Number(isiScore);

    if (isi !== null && (!Number.isFinite(isi) || isi < 0 || isi > 28)) {
      return res.status(400).json({ error: "isiScore must be 0-28" });
    }

    const flags = treatmentsToFlags(suggestedTreatments);

    const result = await pool.query(
      `
      INSERT INTO patients (
        provider_id,
        full_name,
        date_of_birth,
        mobile,
        email,
        isi_score,
        tx_cbti,
        tx_cpap_comisa,
        tx_sleep_eeg,
        tx_zepbound_osa,
        tx_natural_products,
        tx_insomnia_meds_mgmt
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11,$12
      )
      RETURNING id
      `,
      [
        String(provider_id).trim(),
        name.trim(),
        dateOfBirth, // expects YYYY-MM-DD
        mobile.trim(),
        (email || "").trim() || null,
        isi,
        Boolean(flags.tx_cbti),
        Boolean(flags.tx_cpap_comisa),
        Boolean(flags.tx_sleep_eeg),
        Boolean(flags.tx_zepbound_osa),
        Boolean(flags.tx_natural_products),
        Boolean(flags.tx_insomnia_meds_mgmt),
      ]
    );

    return res.status(201).json({ patientId: result.rows[0].id, status: "created" });
  } catch (err) {
    console.error("POST /api/patients error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/patients/public
 * Public flow: provider can add patients WITHOUT signing in.
 *
 * NEW FLOW (practice dropdown):
 * - Frontend sends practice_name (string)
 * - Backend looks up healthie_provider_id from authorizer_users.app_data
 * - Insert patient with provider_id = healthie_provider_id
 *
 * Body:
 * { practiceName, name, dateOfBirth, mobile, email, isiScore, suggestedTreatments }
 */
router.post("/public", async (req, res) => {
  try {
    const {
      practiceName,
      name,
      dateOfBirth,
      mobile,
      email,
      isiScore,
      suggestedTreatments = [],
    } = req.body || {};

    if (!practiceName || !String(practiceName).trim()) {
      return res.status(400).json({ error: "practiceName is required" });
    }
    if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
    if (!dateOfBirth) return res.status(400).json({ error: "dateOfBirth is required" });
    if (!mobile || !mobile.trim()) return res.status(400).json({ error: "mobile is required" });

    const wantedPractice = normalizePracticeName(practiceName);

    // Pull app_data for all users that have it, then find the matching practice_name
    const providerRows = await pool.query(
      `SELECT app_data FROM authorizer_users WHERE app_data IS NOT NULL`
    );

    let healthieProviderId = null;

    for (const row of providerRows.rows) {
      const data =
        typeof row.app_data === "string" ? parseJsonSafe(row.app_data) : row.app_data;

      const practice =
        typeof data?.practice_name === "string" ? normalizePracticeName(data.practice_name) : "";

      if (practice && practice === wantedPractice) {
        const hid = data?.healthie_provider_id ?? data?.healthie_providerId ?? data?.healthie_id;
        if (hid !== undefined && hid !== null && String(hid).trim()) {
          healthieProviderId = String(hid).trim();
          break;
        }
      }
    }

    if (!healthieProviderId) {
      return res.status(404).json({
        error: "Practice not found (no healthie_provider_id stored for that practice).",
      });
    }

    const isi =
      isiScore === "" || isiScore === null || isiScore === undefined
        ? null
        : Number(isiScore);

    if (isi !== null && (!Number.isFinite(isi) || isi < 0 || isi > 28)) {
      return res.status(400).json({ error: "isiScore must be 0-28" });
    }

    const flags = treatmentsToFlags(suggestedTreatments);

    // Store Healthie provider id into patients.provider_id
    const provider_id = healthieProviderId;

    const result = await pool.query(
      `
      INSERT INTO patients (
        provider_id,
        full_name,
        date_of_birth,
        mobile,
        email,
        isi_score,
        tx_cbti,
        tx_cpap_comisa,
        tx_sleep_eeg,
        tx_zepbound_osa,
        tx_natural_products,
        tx_insomnia_meds_mgmt
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11,$12
      )
      RETURNING id
      `,
      [
        provider_id,
        name.trim(),
        dateOfBirth,
        mobile.trim(),
        (email || "").trim() || null,
        isi,
        Boolean(flags.tx_cbti),
        Boolean(flags.tx_cpap_comisa),
        Boolean(flags.tx_sleep_eeg),
        Boolean(flags.tx_zepbound_osa),
        Boolean(flags.tx_natural_products),
        Boolean(flags.tx_insomnia_meds_mgmt),
      ]
    );

    return res.status(201).json({
      patientId: result.rows[0].id,
      status: "created",
      practiceName: String(practiceName).trim(),
      healthie_provider_id: provider_id,
    });
  } catch (err) {
    console.error("POST /api/patients/public error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
