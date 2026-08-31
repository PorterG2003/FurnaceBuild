export type StateDirectoryBlocker = {
  state: string;
  remaining_zeros: string;
  problem: string;
  source_url: string;
};

/** States we cannot fill from a public bulk principal file, plus known-bad parsed files. */
export const STATE_DIRECTORY_BLOCKERS: StateDirectoryBlocker[] = [
  {
    state: 'NC',
    remaining_zeros: '',
    problem: 'NCDPI EDDIE is behind Cloudflare (403 even with Playwright). No public bulk principal file.',
    source_url: 'https://www.dpi.nc.gov/districts-schools/district-operations/school-directory',
  },
  {
    state: 'AZ',
    remaining_zeros: '',
    problem: 'ADE EDD is search-only. No statewide principal export.',
    source_url: 'https://www.azed.gov/edd',
  },
  {
    state: 'FL',
    remaining_zeros: '',
    problem: 'FLDOE MSID download (eds.fldoe.org) returns 503 Service Unavailable.',
    source_url: 'https://eds.fldoe.org/EDS/MasterSchoolID/Downloads/SelectDistrict.cfm?type=2',
  },
  {
    state: 'CA',
    remaining_zeros: '',
    problem: 'CDE pubschls.txt has principal names but no emails. Pattern+MillionVerifier already ran; many guesses failed.',
    source_url: 'https://www.cde.ca.gov/schooldirectory/report?rid=dl1&tp=txt',
  },
  {
    state: 'IL',
    remaining_zeros: '',
    problem: 'ISBE directory has administrator names, almost no emails. Pattern+MV already ran.',
    source_url: 'https://www.isbe.net/Documents/2025-26-Directory-Ed-Entities.xlsx',
  },
  {
    state: 'CO',
    remaining_zeros: '',
    problem: 'CDE School Addresses xlsx is mailing addresses only — zero principal names.',
    source_url: 'https://cedar.cde.state.co.us/edulibdir/School Addresses-en.xlsx',
  },
  {
    state: 'NM',
    remaining_zeros: '',
    problem: 'NMPED principal CSVs sit behind an sgcaptcha interstitial. No unattended download.',
    source_url: 'https://webnew.ped.state.nm.us/bureaus/information-technology/school-directory/',
  },
  {
    state: 'MD',
    remaining_zeros: '',
    problem: 'No statewide principal file. Contacts are per-LEA PDFs (MCPS, HCPS, etc.).',
    source_url: 'https://marylandpublicschools.org/',
  },
  {
    state: 'SC',
    remaining_zeros: '',
    problem: 'Public school-directory JSON is school name/city/phone only. Principal names live in login-walled DEIMS.',
    source_url: 'https://ed.sc.gov/districts-schools/schools/school-directory/',
  },
  {
    state: 'WA',
    remaining_zeros: '',
    problem: 'OSPI principal contacts live in login EDS Admin. Public data portal files are not a principal directory.',
    source_url: 'https://www.k12.wa.us/data-reporting',
  },
  {
    state: 'WV',
    remaining_zeros: '',
    problem: 'WVEIS school-directory CSV is type/name/address/phone/url/grades only — no principals.',
    source_url: 'https://wveis.k12.wv.us/school-directory/download.php?dl',
  },
  {
    state: 'MA',
    remaining_zeros: '',
    problem: 'DESE Profiles people search can export principals but has no bulk file. MassGIS dropped the PRINCIPAL field.',
    source_url: 'https://profiles.doe.mass.edu/search/search_new.aspx?leftNavId=11241',
  },
  {
    state: 'HI',
    remaining_zeros: '',
    problem: 'Phone directory has names; most emails are numeric @k12.hi.us mailboxes which we strip. Pattern+MV barely moved coverage.',
    source_url: 'https://iportal.k12.hi.us/phonedirectory/schoollist',
  },
  {
    state: 'OR',
    remaining_zeros: '',
    problem: 'Institution Lookup Excel has Director_Name (not labeled Principal) and no emails. The Combined Directory with principals is an unstructured PDF.',
    source_url: 'https://www.ode.state.or.us/ftp/incoming/inst_db_extract_XL8.zip',
  },
  {
    state: 'NY',
    remaining_zeros: '',
    problem: 'NYSED SEDREF has administrator reports, but they are portal Crystal/Oracle downloads with no stable public URL.',
    source_url: 'https://p12.nysed.gov/irs/schoolDirectory/',
  },
  {
    state: 'MI',
    remaining_zeros: '',
    problem: 'CEPI EEM can download lead-administrator lists after a search form; no one-click statewide principal CSV.',
    source_url: 'https://cepi.state.mi.us/eem/PublicDatasets.aspx',
  },
  {
    state: 'LA',
    remaining_zeros: '',
    problem: 'Principal data sits in the secure Sponsor Site / School Finder portal. No public bulk file.',
    source_url: 'https://www.louisianaschools.com/',
  },
  {
    state: 'MN',
    remaining_zeros: '',
    problem: 'MDE-ORG can generate lists, but Site Verification (principal + email) is EDIAM-login. No anonymous bulk file.',
    source_url: 'https://education.mn.gov/mde/about/SchOrg/',
  },
  {
    state: 'ID',
    remaining_zeros: '',
    problem: 'Public IDCI report id=14 is a program-contact dump (Title III / federal programs), not a full principal directory. Only rows titled Principal are kept.',
    source_url: 'https://apps.sde.idaho.gov/IDCI/Reports/ViewReport.aspx?id=14',
  },
  {
    state: 'AL',
    remaining_zeros: '',
    problem: 'ALSDE EdDir grid has Administrator + Export CSV, but Playwright never received a download (timeout). Likely exports visible page only or needs View Information first.',
    source_url: 'https://eddir.alsde.edu/SiteInfo/PublicPrivateReligiousSites',
  },
];
