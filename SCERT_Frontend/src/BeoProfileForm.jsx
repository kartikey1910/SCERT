import { useState, useEffect } from "react";
import { get, put } from "./apiClient.js";
import { useAuth } from "./AuthContext.jsx";
import { useToast } from "./ToastContext.jsx";

export function BeoProfileForm({
  mode = "complete",
  onSuccess,
  onError,
  onClose,
}) {
  const { auth } = useAuth();
  const toast = useToast();
  const isEdit = String(mode).toLowerCase() === "edit";
  const [readOnlyData, setReadOnlyData] = useState({
    block_name: "",
    block_code: "",
    unit_id: "",
    district_code: "",
    district_name: "",
  });
  const [formData, setFormData] = useState({
    beo_name: "",
    address: "",
    beo_account_no: "",
    beo_ifsc_code: "",
    beo_bank_name: "",
    distance_from_district_hq_km: "",
    contact_number: "",
    email: "",
    beo_mobile: "",
    dealing_person_name: "",
    dealing_person_mobile: "",
  });
  const [loading, setLoading] = useState(false);
  const [fetchingProfile, setFetchingProfile] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const data = await get("/api/beo/profile", { token: auth?.token });
        if (data.profile) {
          setReadOnlyData({
            block_name: data.profile.block_name || "",
            block_code: data.profile.block_code || "",
            unit_id: data.profile.unit_id || "",
            district_code: data.profile.district_code || "",
            district_name: data.profile.district_name || "",
          });
          setFormData({
            beo_name: data.profile.beo_name || "",
            address: data.profile.address || "",
            beo_account_no: data.profile.beo_account_no || "",
            beo_ifsc_code: data.profile.beo_ifsc_code || "",
            beo_bank_name: data.profile.beo_bank_name || "",
            distance_from_district_hq_km:
              data.profile.distance_from_district_hq_km || "",
            contact_number: data.profile.contact_number || "",
            email: data.profile.email || "",
            beo_mobile: data.profile.beo_mobile || "",
            dealing_person_name: data.profile.dealing_person_name || "",
            dealing_person_mobile: data.profile.dealing_person_mobile || "",
          });
        }
      } catch (err) {
        console.error("Failed to fetch profile:", err);
        setError(toast.getErrorMessage(err, "Failed to load profile"));
        toast.error(`Failed to load profile: ${toast.getErrorMessage(err)}`);
      } finally {
        setFetchingProfile(false);
      }
    };

    fetchProfile();
  }, [auth?.token]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    const nextValue =
      name === "beo_name" || name === "dealing_person_name"
        ? String(value || "").toUpperCase()
        : value;
    setFormData({ ...formData, [name]: nextValue });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!formData.beo_name) {
      setError("Please fill all required fields");
      toast.error("Please fill all required fields");
      return;
    }

    setLoading(true);
    try {
      const payload = { ...formData };
      if (payload.distance_from_district_hq_km) {
        payload.distance_from_district_hq_km = parseFloat(
          payload.distance_from_district_hq_km,
        );
      }
      const endpoint = isEdit
        ? "/api/beo/profile/edit"
        : "/api/beo/profile/complete";
      await put(endpoint, payload, { token: auth?.token });
      toast.success(
        isEdit
          ? "Profile updated successfully"
          : "Profile completed successfully",
      );
      onSuccess?.();
    } catch (err) {
      const errorMsg = toast.getErrorMessage(err, "Failed to save profile");
      setError(errorMsg);
      toast.error(`Failed to save profile: ${errorMsg}`);
      if (onError) onError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay auth-profile-overlay">
      <div className="modal-content profile-modal auth-profile-modal">
        <div className="modal-header auth-profile-header">
          <div className="auth-password-header-row">
            <div>
              <h2 className="modal-title auth-profile-title">
                {isEdit ? "Edit Your BEO Profile" : "Complete Your BEO Profile"}
              </h2>
              <p className="modal-subtitle">
                {isEdit
                  ? "Update your profile details and save changes."
                  : "Please provide the following details to complete your profile."}
              </p>
            </div>
            {onClose && (
              <button
                type="button"
                className="auth-password-close"
                onClick={onClose}
                aria-label="Close"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="modal-form profile-form">
          {readOnlyData.block_name && (
            <>
              <div className="form-row">
                <div className="form-field full-width">
                  <label className="form-label">Unit ID</label>
                  <input
                    type="text"
                    className="form-input"
                    value={readOnlyData.unit_id}
                    disabled
                    readOnly
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-field">
                  <label className="form-label">Block Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={readOnlyData.block_name}
                    disabled
                    readOnly
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">Block Code</label>
                  <input
                    type="text"
                    className="form-input"
                    value={readOnlyData.block_code}
                    disabled
                    readOnly
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">District Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={readOnlyData.district_name}
                    disabled
                    readOnly
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">District Code</label>
                  <input
                    type="text"
                    className="form-input"
                    value={readOnlyData.district_code}
                    disabled
                    readOnly
                  />
                </div>
              </div>
            </>
          )}

          <div className="form-field">
            <label className="form-label" htmlFor="address">
              Address
            </label>
            <textarea
              id="address"
              name="address"
              className="form-input"
              placeholder="Enter complete address"
              value={formData.address}
              onChange={handleChange}
              rows="3"
              disabled={loading}
            />
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label" htmlFor="contact_number">
                Contact Number of Office
              </label>
              <input
                id="contact_number"
                name="contact_number"
                type="tel"
                className="form-input"
                placeholder="Enter contact number"
                value={formData.contact_number}
                onChange={handleChange}
                disabled={loading}
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="email">
                Email of Office <span className="required">*</span>
              </label>
              <input
                id="email"
                name="email"
                type="email"
                className="form-input"
                placeholder="Enter email address"
                value={formData.email}
                onChange={handleChange}
                disabled={loading}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label" htmlFor="beo_account_no">
                Account Number
              </label>
              <input
                id="beo_account_no"
                name="beo_account_no"
                type="text"
                className="form-input"
                placeholder="Enter account number"
                value={formData.beo_account_no}
                onChange={handleChange}
                disabled={loading}
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="beo_ifsc_code">
                IFSC Code
              </label>
              <input
                id="beo_ifsc_code"
                name="beo_ifsc_code"
                type="text"
                className="form-input"
                placeholder="Enter IFSC code"
                value={formData.beo_ifsc_code}
                onChange={handleChange}
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label" htmlFor="beo_bank_name">
                Bank Name
              </label>
              <input
                id="beo_bank_name"
                name="beo_bank_name"
                type="text"
                className="form-input"
                placeholder="Enter bank name"
                value={formData.beo_bank_name}
                onChange={handleChange}
                disabled={loading}
              />
            </div>

            <div className="form-field">
              <label
                className="form-label"
                htmlFor="distance_from_district_hq_km"
              >
                Distance from CEO Office (km)
              </label>
              <input
                id="distance_from_district_hq_km"
                name="distance_from_district_hq_km"
                type="number"
                step="0.1"
                className="form-input"
                placeholder="Enter distance"
                value={formData.distance_from_district_hq_km}
                onChange={handleChange}
                disabled={loading}
              />
            </div>
          </div>

          

          <div className="form-row">
            <div className="form-field">
              <label className="form-label" htmlFor="beo_name">
                BEO Name <span className="required">*</span>
              </label>
              <input
                id="beo_name"
                name="beo_name"
                type="text"
                className="form-input"
                placeholder="Enter BEO name"
                value={formData.beo_name}
                onChange={handleChange}
                disabled={loading}
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="beo_mobile">
                BEO Mobile <span className="required">*</span>
              </label>
              <input
                id="beo_mobile"
                name="beo_mobile"
                type="tel"
                className="form-input"
                placeholder="Enter BEO mobile number"
                value={formData.beo_mobile}
                onChange={handleChange}
                disabled={loading}
                required
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-field">
              <label className="form-label" htmlFor="dealing_person_name">
                Dealing Person Name <span className="required">*</span>
              </label>
              <input
                id="dealing_person_name"
                name="dealing_person_name"
                type="text"
                className="form-input"
                placeholder="Enter dealing person name"
                value={formData.dealing_person_name}
                onChange={handleChange}
                disabled={loading}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="dealing_person_mobile">
                Dealing Person Mobile <span className="required">*</span>
              </label>
              <input
                id="dealing_person_mobile"
                name="dealing_person_mobile"
                type="tel"
                className="form-input"
                placeholder="Enter dealing person mobile"
                value={formData.dealing_person_mobile}
                onChange={handleChange}
                disabled={loading}
                required
              />
            </div>
          </div>
          {error && <div className="form-error">{error}</div>}

          <button
            type="submit"
            className="modal-button auth-profile-button"
            disabled={loading}
          >
            {loading
              ? "Saving Profile..."
              : isEdit
                ? "Save Changes"
                : "Complete Profile"}
          </button>
        </form>
      </div>
    </div>
  );
}
