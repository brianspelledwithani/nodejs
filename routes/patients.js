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

/**
 * POST /api/patients
 * (Logged-in flow later)
 * For now it expects provider_id to be provided in the request body.
 *
 * NOTE: if you are switching your "provider_id" meaning to Healthie provider id,
 * this route will still work, but now "provider_id" should be the Healthie ID.
 */
router.post("/", async (req, res) => {
  try {
    const {
      provider_id,
      name,
      dateOfBirth,
      mobile,

      // OPTIONAL
      email,
      isiScore,

      // UI sends: suggestedTreatments: string[]
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

    const {
      tx_cbti,
      tx_cpap_comisa,
      tx_sleep_eeg,
      tx_zepbound_osa,
      tx_natural_products,
      tx_insomnia_meds_mgmt,
    } = treatmentsToFlags(suggestedTreatments);

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
        dateOfBirth, // expects YYYY-MM-DD
        mobile.trim(),
        (email || "").trim() || null,
        isi,
        Boolean(tx_cbti),
        Boolean(tx_cpap_comisa),
        Boolean(tx_sleep_eeg),
        Boolean(tx_zepbound_osa),
        Boolean(tx_natural_products),
        Boolean(tx_insomnia_meds_mgmt),
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
 * NEW FLOW:
 * - Frontend sends the selected practice's Healthie Provider ID
 * - We store that ID into patients.provider_id
 *
 * Body:
 * {
 *   healthie_provider_id: "12345",
 *   practiceName: "Autonoos LLC Clinic" (optional - for display only),
 *   name, dateOfBirth, mobile,
 *   email, isiScore,
 *   suggestedTreatments: string[]
 * }
 */
router.post("/public", async (req, res) => {
  try {
    const {
      healthie_provider_id,
      practiceName, // optional (not used for lookup; just informational)
      name,
      dateOfBirth,
      mobile,

      email,
      isiScore,

      suggestedTreatments = [],
    } = req.body || {};

    if (!healthie_provider_id || !String(healthie_provider_id).trim()) {
      return res.status(400).json({ error: "healthie_provider_id is required" });
    }
    if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
    if (!dateOfBirth) return res.status(400).json({ error: "dateOfBirth is required" });
    if (!mobile || !mobile.trim()) return res.status(400).json({ error: "mobile is required" });

    // Optional: validate isiScore
    const isi =
      isiScore === "" || isiScore === null || isiScore === undefined
        ? null
        : Number(isiScore);

    if (isi !== null && (!Number.isFinite(isi) || isi < 0 || isi > 28)) {
      return res.status(400).json({ error: "isiScore must be 0-28" });
    }

    const {
      tx_cbti,
      tx_cpap_comisa,
      tx_sleep_eeg,
      tx_zepbound_osa,
      tx_natural_products,
      tx_insomnia_meds_mgmt,
    } = treatmentsToFlags(suggestedTreatments);

    // Store Healthie provider id into patients.provider_id
    const provider_id = String(healthie_provider_id).trim();

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
        Boolean(tx_cbti),
        Boolean(tx_cpap_comisa),
        Boolean(tx_sleep_eeg),
        Boolean(tx_zepbound_osa),
        Boolean(tx_natural_products),
        Boolean(tx_insomnia_meds_mgmt),
      ]
    );

    return res.status(201).json({
      patientId: result.rows[0].id,
      status: "created",
      practiceName: (practiceName || "").trim() || undefined,
      healthie_provider_id: provider_id,
    });
  } catch (err) {
    console.error("POST /api/patients/public error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
