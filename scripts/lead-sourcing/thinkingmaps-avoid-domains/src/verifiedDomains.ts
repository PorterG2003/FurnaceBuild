export type DomainVerification = {
  domain: string;
  sampleEmail: string;
  evidenceUrl: string;
};

export type ManualVerification = {
  lookupName: string;
  status: 'verified' | 'partial' | 'ambiguous';
  domains: DomainVerification[];
  note?: string;
};

const d = (domain: string, sampleEmail: string, evidenceUrl: string): DomainVerification => ({
  domain,
  sampleEmail,
  evidenceUrl,
});

export const MANUAL_VERIFICATIONS: ManualVerification[] = [
  {
    lookupName: 'Alpine District',
    status: 'verified',
    domains: [
      d(
        'alpinedistrict.org',
        'samanthaakiyama@alpinedistrict.org',
        'https://www.alpineschools.org/o/mountain-ridge/staff',
      ),
    ],
    note: 'alpineschools.org is the website domain only',
  },
  {
    lookupName: 'Anaheim Elementary SD',
    status: 'verified',
    domains: [
      d(
        'aesd.org',
        'bgordillo@aesd.org',
        'https://anaheimelementary.org/staff-and-media-contacts/',
      ),
    ],
    note: 'anaheimelementary.org is the website domain only',
  },
  {
    lookupName: 'Anderson School District 03',
    status: 'verified',
    domains: [
      d(
        'acsd3.org',
        'davism@acsd3.org',
        'https://www.anderson3.k12.sc.us/live-feed?page_no=10',
      ),
    ],
  },
  {
    lookupName: 'Anderson School District 05',
    status: 'verified',
    domains: [
      d(
        'anderson5.net',
        'victoriabailey@anderson5.net',
        'https://robertanderson.anderson5.net/apps/pages/index.jsp?pREC_ID=2491275&type=d&uREC_ID=4053361',
      ),
    ],
  },
  {
    lookupName: 'Ararat Charter District',
    status: 'verified',
    domains: [
      d(
        'araratcharterschool.com',
        'atate@araratcharterschool.com',
        'https://www.cde.ca.gov/schooldirectory/details?cdscode=19647330121079',
      ),
    ],
    note: 'Ararat is an LAUSD-authorized charter; araratcharter.org was incorrect',
  },
  {
    lookupName: 'Atascadero Unified',
    status: 'verified',
    domains: [
      d(
        'atasusd.org',
        'kaitlynngreenberg@atasusd.org',
        'https://www.atasusd.org/District/96-Student-Intervention-Services.html',
      ),
    ],
  },
  {
    lookupName: 'Big Sandy School District No. 100J',
    status: 'verified',
    domains: [
      d(
        'bigsandy100j.org',
        'drobinson@bigsandy100j.org',
        'https://bigsandy100j.com/staff/',
      ),
    ],
    note: 'bigsandy100j.com is the website domain only',
  },
  {
    lookupName: 'Raleigh County Schools',
    status: 'partial',
    domains: [],
    note: 'Use only published Raleigh staff addresses; k12.wv.us is shared by every West Virginia district',
  },
  {
    lookupName: 'Public Schools of Brookline',
    status: 'verified',
    domains: [
      d(
        'psbma.org',
        'meaghan_geaney@psbma.org',
        'https://www.brookline.k12.ma.us/registration',
      ),
    ],
    note: 'brookline.k12.ma.us is legacy; current staff use psbma.org',
  },
  {
    lookupName: 'Bellflower Unified School District',
    status: 'verified',
    domains: [
      d(
        'busd.k12.ca.us',
        'superintendent@busd.k12.ca.us',
        'https://www.busd.k12.ca.us/our-district',
      ),
    ],
  },
  {
    lookupName: 'Caliente Union Elementary',
    status: 'verified',
    domains: [
      d(
        'calienteschooldistrict.org',
        'rshive@calienteschooldistrict.org',
        'https://calienteschooldistrict.org/piute/contact-us/',
      ),
    ],
  },
  {
    lookupName: 'Capistrano Unified School District',
    status: 'verified',
    domains: [
      d(
        'capousd.org',
        'bepresby@capousd.org',
        'https://www.capousd.org/subsites/Human-Resource-Services/Contact-Us/index.html',
      ),
    ],
  },
  {
    lookupName: 'Clark County School District',
    status: 'verified',
    domains: [
      d(
        'nv.ccsd.net',
        'communications@nv.ccsd.net',
        'https://newsroom.ccsd.net/media-contacts/',
      ),
    ],
    note: 'ccsd.net is the website apex; current employee mail uses nv.ccsd.net',
  },
  {
    lookupName: 'Christ Episcopal School',
    status: 'verified',
    domains: [
      d(
        'christepiscopalschool.org',
        'mtodd@christepiscopalschool.org',
        'https://christepiscopalschool.org/academics/college-counseling/',
      ),
    ],
  },
  {
    lookupName: 'Durango School District No. 9-R',
    status: 'verified',
    domains: [
      d(
        'durangoschools.org',
        'ehenthorn@durangoschools.org',
        'https://www.durangoschools.org/apps/pages/backtoschool',
      ),
    ],
  },
  {
    lookupName: 'Eagle County School District No. Re 50',
    status: 'verified',
    domains: [
      d(
        'eagleschools.net',
        'john.donnelly@eagleschools.net',
        'https://technology.eagleschools.net/meet-the-team',
      ),
    ],
  },
  {
    lookupName: 'Educational Service Center of the Western Reserve',
    status: 'verified',
    domains: [
      d(
        'escwr.org',
        'jfelker@escwr.org',
        'https://www.escwr.org/Downloads/FY26%20-%20HPESC%20ESC%20of%20the%20Western%20Reserve.pdf?v=296',
      ),
    ],
  },
  {
    lookupName: 'Fenton Avenue Charter District',
    status: 'verified',
    domains: [
      d(
        'fentoncharter.net',
        'mcastaneda@fentoncharter.net',
        'https://www.fentoncharter.net/our-schools/fenton-avenue-charter-school',
      ),
    ],
  },
  {
    lookupName: 'Hawaii Department Of Education',
    status: 'verified',
    domains: [
      d(
        'k12.hi.us',
        'teacher.recruitment@k12.hi.us',
        'https://hawaiipublicschools.org/jobs/jobs-listing/',
      ),
    ],
    note: 'hawaiipublicschools.org is the website domain only',
  },
  {
    lookupName: 'Isucceed Virtual High School',
    status: 'verified',
    domains: [
      d(
        'isucceedvhs.net',
        'info@isucceedvhs.net',
        'https://isucceedvhs.net/contact-us/',
      ),
    ],
  },
  {
    lookupName: 'Jerome Joint District',
    status: 'verified',
    domains: [
      d(
        'jeromeschools.org',
        'jodi.stewart@jeromeschools.org',
        'https://www.jeromeschools.org/jsd-staff/jodi-stewart',
      ),
    ],
  },
  {
    lookupName: 'Lancaster County School District SC',
    status: 'verified',
    domains: [
      d(
        'lcsd.k12.sc.us',
        'benja.jenkins@lcsd.k12.sc.us',
        'https://www.lancastercsd.com/page/information',
      ),
    ],
    note: 'lancastercsd.com is the website domain only',
  },
  {
    lookupName: 'Los Angeles Unified',
    status: 'verified',
    domains: [
      d(
        'lausd.net',
        'tania.ardon@lausd.net',
        'https://its.lausd.org/apps/pages/index.jsp?uREC_ID=4385867&type=d&pREC_ID=2620120',
      ),
    ],
  },
  {
    lookupName: 'Laurens County',
    status: 'verified',
    domains: [
      d(
        'lcboe.net',
        'timpassmore@lcboe.net',
        'https://www.lcboe.net/title-ix-information',
      ),
    ],
  },
  {
    lookupName: 'Leominster',
    status: 'verified',
    domains: [
      d(
        'leominsterps.org',
        'amanda.randall@leominsterps.org',
        'https://www.leominsterps.org/schools/leominster-high-school/blog/1635212/lhs-update-november-1',
      ),
    ],
  },
  {
    lookupName: 'Lydia Patterson Institute',
    status: 'verified',
    domains: [
      d(
        'lpi-elpaso.org',
        'c.cardoza@lpi-elpaso.org',
        'https://www.lpi-elpaso.org/o/lpi/staff',
      ),
    ],
  },
  {
    lookupName: 'Metro Nashville Public Schools',
    status: 'verified',
    domains: [
      d(
        'mnps.org',
        'familyinfo@mnps.org',
        'https://www.mnps.org/departments/directory',
      ),
    ],
  },
  {
    lookupName: 'Mesa Public Schools',
    status: 'verified',
    domains: [
      d(
        'mpsaz.org',
        'ckgutierrez@mpsaz.org',
        'https://roosevelt.mpsaz.org/staff',
      ),
    ],
  },
  {
    lookupName: 'North County Joint Union Elementary',
    status: 'verified',
    domains: [
      d(
        'ncjusd.org',
        'jbernosky@ncjusd.org',
        'https://www.ncjusd.org/spring-grove/content/uploads/2025_School_Accountability_Report_Card_North_County_Joint_Union_Elementary_School_District_20260102.pdf',
      ),
    ],
    note: 'ncjuesd.org contained an extra letter and was incorrect',
  },
  {
    lookupName: 'Nieto Herrera Elementary School',
    status: 'verified',
    domains: [
      d(
        'lbschools.net',
        'akargas@lbschools.net',
        'https://nieto-herrera.lbschools.net/staff/admin',
      ),
    ],
  },
  {
    lookupName: 'National Elementary School District',
    status: 'verified',
    domains: [
      d(
        'nsd.us',
        'rvargas@nsd.us',
        'https://nsd.us/ourpages/auto/2025/5/11/35963098/NSD%20Annual%20Notification%20English%2025-26%20SY.pdf',
      ),
    ],
  },
  {
    lookupName: 'New York State Parent Teachers Association',
    status: 'verified',
    domains: [
      d(
        'nyspta.org',
        'craymond@nyspta.org',
        'https://nyspta.org/home/about/contact/contacts-nys-pta-staff/',
      ),
    ],
  },
  {
    lookupName: 'Owens Valley Unified',
    status: 'verified',
    domains: [
      d('ovusd.org', 'llawson@ovusd.org', 'https://www.ovusd.org/title-ix-sexual-harassment'),
    ],
  },
  {
    lookupName: 'Parlier Unified School District',
    status: 'verified',
    domains: [
      d(
        'parlierunified.org',
        'juan.reynoso@parlierunified.org',
        'https://www.parlierunified.org/apps/pages/index.jsp?pREC_ID=1602524&type=d&uREC_ID=1208230',
      ),
      d(
        'parlier.k12.ca.us',
        'earjon@parlier.k12.ca.us',
        'https://www.parlierunified.org/apps/pages/index.jsp?pREC_ID=1602524&type=d&uREC_ID=1208230',
      ),
    ],
    note: 'Current site uses both current and legacy staff email domains',
  },
  {
    lookupName: 'PARNASSUS PREPARATORY CHARTER SCH',
    status: 'verified',
    domains: [
      d(
        'parnassusprep.com',
        'zehnpfennig@parnassusprep.com',
        'https://parnassusprep.com/our-schools/school-directory/',
      ),
    ],
  },
  {
    lookupName: 'Panama-Buena Vista Union',
    status: 'verified',
    domains: [
      d(
        'pbvusd.k12.ca.us',
        'jdulcich@pbvusd.k12.ca.us',
        'https://www.pbvusd.k12.ca.us/about-us/schools',
      ),
    ],
  },
  {
    lookupName: 'Phoenix Elementary District',
    status: 'verified',
    domains: [
      d(
        'phxschools.org',
        'silvia.encinas@phxschools.org',
        'https://www.phxschools.org/employees/home',
      ),
    ],
  },
  {
    lookupName: 'Pioneer Union Elementary',
    status: 'verified',
    domains: [
      d(
        'puesd.net',
        'ravenj@puesd.net',
        'https://www.cde.ca.gov/schooldirectory/details?cdscode=16639900000000',
      ),
    ],
    note: 'pioneerunion.org is the website domain only',
  },
  {
    lookupName: 'Pond Union Elementary',
    status: 'verified',
    domains: [
      d(
        'pond.k12.ca.us',
        'alopez@pond.k12.ca.us',
        'https://pond.k12.ca.us/District/1138-Contact-Us.html',
      ),
    ],
  },
  {
    lookupName: 'Pomona Unified',
    status: 'verified',
    domains: [
      d(
        'pusd.org',
        'natalie.bogg@pusd.org',
        'https://proudtobe.pusd.org/apps/pages/adulttransitionprogram',
      ),
    ],
  },
  {
    lookupName: 'Ravenswood City School District',
    status: 'verified',
    domains: [
      d(
        'ravenswoodschools.org',
        'solomonh@ravenswoodschools.org',
        'https://www.ravenswoodschools.org/Choose-Ravenswood/Departments/Technology/',
      ),
    ],
  },
  {
    lookupName: 'Santa Maria-Bonita School District',
    status: 'verified',
    domains: [
      d(
        'smbsd.net',
        'pbland@smbsd.net',
        'https://www.smbsd.org/service-areas/human-resources/jobfair',
      ),
    ],
    note: 'smbsd.org is the website domain only',
  },
  {
    lookupName: 'Southside School District',
    status: 'verified',
    domains: [
      d('southsideschool.org', 'gwoods@southsideschool.org', 'https://southsideschool.org/'),
    ],
  },
  {
    lookupName: 'St. Bernard Catholic School',
    status: 'verified',
    domains: [
      d(
        'stbernardcatholicschool.com',
        'principal@stbernardcatholicschool.com',
        'https://www.stbernardcatholicschool.com/faculty-and-staff.html',
      ),
    ],
  },
  {
    lookupName: 'St. Vrain Valley School District No. Re1J',
    status: 'verified',
    domains: [
      d(
        'svvsd.org',
        'thompson_amanda@svvsd.org',
        'https://www.svvsd.org/departments/human-resources/human-resources-team/',
      ),
    ],
  },
  {
    lookupName: 'LaunchED Academy',
    status: 'verified',
    domains: [
      d('svvsd.org', 'launched@svvsd.org', 'https://launched.svvsd.org/'),
    ],
    note: '619 Bowen Street identifies St. Vrain LaunchED Virtual Academy; mylaunched.com was a false match',
  },
  {
    lookupName: 'Taft City',
    status: 'verified',
    domains: [
      d(
        'taftcity.org',
        'mtaylor@taftcity.org',
        'https://www.cde.ca.gov/schooldirectory/details?cdscode=15638000000000',
      ),
    ],
    note: 'taftcityschools.com is the website domain only',
  },
  {
    lookupName: 'Two Rock Union School District',
    status: 'verified',
    domains: [
      d(
        'trusd.org',
        'jmarkatos@trusd.org',
        'https://www.trusd.org/_files/ugd/2f65fe_f21b401534f74c28bfb3ae3016f63376.pdf',
      ),
    ],
  },
  {
    lookupName: 'Tucson Unified School District',
    status: 'verified',
    domains: [
      d('tusd1.org', 'rosamaria.duarteraub@tusd1.org', 'https://ochoaes.tusd1.org/staff-25-26'),
    ],
  },
  {
    lookupName: 'Temecula Valley Unified',
    status: 'verified',
    domains: [
      d(
        'tvusd.us',
        'kbrejnak@tvusd.us',
        'https://www.tvusd.k12.ca.us/business-support-services/fiscal-servicespayroll/fiscal-services/staff',
      ),
    ],
  },
  {
    lookupName: 'Union Elementary',
    status: 'verified',
    domains: [
      d(
        'unionsd.org',
        'feinbergt@unionsd.org',
        'https://unionms.unionsd.org/teams-staff/office-staff',
      ),
    ],
  },
  {
    lookupName: 'Victor Elementary School District',
    status: 'verified',
    domains: [
      d('vesd.net', 'mdaugherty@vesd.net', 'https://www.vesd.net/departments/fiscal-services'),
    ],
  },
  {
    lookupName: 'Victor Valley Union High',
    status: 'verified',
    domains: [
      d(
        'vvuhsd.org',
        'hpauling@vvuhsd.org',
        'https://www.vvuhsd.org/departments/superintendents-office',
      ),
    ],
  },
  {
    lookupName: 'West Covina Unified School District',
    status: 'verified',
    domains: [
      d(
        'wcusd.org',
        'dknutsen@wcusd.org',
        'https://www.wcusd.org/departments/educational-services',
      ),
    ],
  },
  {
    lookupName: 'Wisconsin Lutheran High School',
    status: 'verified',
    domains: [
      d(
        'wlhs.org',
        'brad.wetzel@wlhs.org',
        'https://www.wlhs.org/admissions/welcome-to-wisconsin-lutheran',
      ),
    ],
  },
  {
    lookupName: 'Wonderful College Prep Academy - Lost Hills District',
    status: 'verified',
    domains: [
      d(
        'wonderfulcollegeprep.org',
        'jorge.aguilar@wonderfulcollegeprep.org',
        'https://www.cde.ca.gov/SchoolDirectory/details?cdscode=15101570119669',
      ),
    ],
  },
  {
    lookupName: 'Western Placer Unified',
    status: 'verified',
    domains: [
      d('wpusd.org', 'kperry@wpusd.org', 'https://www.wpusd.org/departments/administrative-services/it'),
    ],
  },
  {
    lookupName: 'Whittier Union High',
    status: 'verified',
    domains: [
      d(
        'wuhsd.org',
        'lilia.bozigian@wuhsd.org',
        'https://www.wuhsd.org/apps/pages/index.jsp?pREC_ID=1159552&type=d&uREC_ID=750081',
      ),
    ],
  },
  {
    lookupName: 'Youngstown City Schools',
    status: 'verified',
    domains: [
      d(
        'youngstown.k12.oh.us',
        'jeremy.batchelor@youngstown.k12.oh.us',
        'https://www.ycsd.org/page/superintendent',
      ),
    ],
    note: 'ycsd.org is the website domain only',
  },
  {
    lookupName: 'NEWARK CENTRAL SCHOOL DISTRICT',
    status: 'verified',
    domains: [
      d(
        'newarkcsd.org',
        'debora.barry@newarkcsd.org',
        'https://www.newarkcsd.org/community-education',
      ),
    ],
  },
  {
    lookupName: 'Northborough-Southborough',
    status: 'verified',
    domains: [
      d(
        'nsboro.k12.ma.us',
        'klavoie@nsboro.k12.ma.us',
        'https://www.nsboro.k12.ma.us/asbestos-notification',
      ),
    ],
  },
  {
    lookupName: 'Nyack Public Schools',
    status: 'verified',
    domains: [
      d(
        'nyackschools.org',
        'smena@nyackschools.org',
        'https://www.nyackschools.org/departments/registration',
      ),
    ],
  },
  {
    lookupName: 'Rochester City School District',
    status: 'verified',
    domains: [
      d(
        'rcsdk12.org',
        'michael.mahaney@rcsdk12.org',
        'https://www.rcsdk12.org/departments/finance/office-of-budget-and-revenue',
      ),
    ],
  },
  {
    lookupName: 'Rockford SD 205',
    status: 'verified',
    domains: [
      d('rps205.com', 'diehlf@rps205.com', 'https://www.rps205.com/Staff'),
    ],
  },
  {
    lookupName: 'Salem-Keizer Public Schools',
    status: 'verified',
    domains: [
      d(
        'salkeiz.k12.or.us',
        'north_web@salkeiz.k12.or.us',
        'https://north.salkeiz.k12.or.us/about/contact-us',
      ),
    ],
  },
  {
    lookupName: 'New York City Geographic District #12',
    status: 'verified',
    domains: [
      d(
        'schools.nyc.gov',
        'cchan2@schools.nyc.gov',
        'https://www.schools.nyc.gov/about-us/leadership/district-leadership',
      ),
    ],
  },
  {
    lookupName: 'New York City Geographic District #25',
    status: 'verified',
    domains: [
      d(
        'schools.nyc.gov',
        'cchan2@schools.nyc.gov',
        'https://www.schools.nyc.gov/about-us/leadership/district-leadership',
      ),
    ],
  },
  {
    lookupName: 'New York City Geographic District # 4',
    status: 'verified',
    domains: [
      d(
        'schools.nyc.gov',
        'cchan2@schools.nyc.gov',
        'https://www.schools.nyc.gov/about-us/leadership/district-leadership',
      ),
    ],
  },
  {
    lookupName: 'New York City Geographic District # 2',
    status: 'verified',
    domains: [
      d(
        'schools.nyc.gov',
        'cchan2@schools.nyc.gov',
        'https://www.schools.nyc.gov/about-us/leadership/district-leadership',
      ),
    ],
  },
  {
    lookupName: 'Memphis-Shelby County Schools',
    status: 'verified',
    domains: [
      d(
        'scsk12.org',
        'richmondrf@scsk12.org',
        'https://www.scsk12.org/seniorleaders/',
      ),
    ],
  },
  {
    lookupName: 'Socorro ISD',
    status: 'verified',
    domains: [
      d(
        'sisd.net',
        'gwidne@sisd.net',
        'https://www.sisd.net/o/socorrohs/article/3069762',
      ),
    ],
  },
  {
    lookupName: 'San Luis Coastal Unified',
    status: 'verified',
    domains: [
      d('slcusd.org', 'district@slcusd.org', 'https://www.slcusd.org/contact-us2'),
    ],
  },
  {
    lookupName: 'Westchester Boces',
    status: 'verified',
    domains: [
      d(
        'swboces.org',
        'jbullitt@swboces.org',
        'https://www.swboces.org/page/hr-freqently-asked-questions',
      ),
    ],
  },
  {
    lookupName: 'Winston-Salem Forsyth County Schools',
    status: 'verified',
    domains: [
      d(
        'wsfcs.k12.nc.us',
        'tmbarnesjones@wsfcs.k12.nc.us',
        'https://www.wsfcs.k12.nc.us/page/office-of-talent-development-and-school-transformation',
      ),
    ],
  },
  {
    lookupName: 'Ysleta ISD',
    status: 'verified',
    domains: [
      d(
        'yisd.net',
        'lbaeza4@yisd.net',
        'https://www.yisd.net/page/associate-superintendents-office',
      ),
    ],
  },
  {
    lookupName: 'Anne Arundel County Public Schools',
    status: 'verified',
    domains: [
      d(
        'aacps.org',
        'earlychildhood@aacps.org',
        'https://www.aacps.org/article/2853198',
      ),
    ],
  },
  {
    lookupName: 'Boulder Valley School District No. Re2',
    status: 'verified',
    domains: [
      d(
        'bvsd.org',
        'bryant.shaw@bvsd.org',
        'https://cam.bvsd.org/staff-directory',
      ),
    ],
  },
  {
    lookupName: 'Culver City Unified',
    status: 'verified',
    domains: [
      d(
        'ccusd.org',
        'donnabergonzi@ccusd.org',
        'https://ccms.ccusd.org/apps/pages/index.jsp?pREC_ID=staff&type=d&uREC_ID=362463',
      ),
    ],
  },
  {
    lookupName: 'Des Moines Independent Comm School District',
    status: 'verified',
    domains: [
      d(
        'dmschools.org',
        'jason.allen@dmschools.org',
        'https://activities.dmschools.org/wp-content/uploads/sites/24/2026/07/2026-27-DMPS-Activities-Contact.pdf',
      ),
    ],
  },
  {
    lookupName: 'Eastern Suffolk BOCES (District)',
    status: 'verified',
    domains: [
      d(
        'esboces.org',
        'nrivers@esboces.org',
        'https://www.esboces.org/programs-services/hr/contact-us',
      ),
    ],
  },
  {
    lookupName: 'Fort Bend ISD',
    status: 'verified',
    domains: [
      d(
        'fortbendisd.gov',
        'support@fortbendisd.gov',
        'https://www.fortbendisd.com/calendar',
      ),
    ],
    note: 'fortbendisd.com is legacy; current official staff and role addresses use fortbendisd.gov',
  },
  {
    lookupName: 'FRANKLIN SQUARE UNION FREE SCHOOL DISTRICT',
    status: 'verified',
    domains: [
      d(
        'franklinsquare.k12.ny.us',
        'lschneider@franklinsquare.k12.ny.us',
        'https://www.franklinsquare.k12.ny.us/article/2637393',
      ),
    ],
  },
  {
    lookupName: 'Hemet Unified',
    status: 'verified',
    domains: [
      d(
        'hemetusd.org',
        'rpoe@hemetusd.org',
        'https://www.hemetusd.org/o/dartmouth/staff',
      ),
    ],
  },
  {
    lookupName: 'Irvine Unified School District',
    status: 'verified',
    domains: [
      d(
        'iusd.org',
        'stanmachesky@iusd.org',
        'https://iusd.org/about/departments/education-services/ed-services-contact-us',
      ),
    ],
  },
  {
    lookupName: 'La Habra City School District',
    status: 'verified',
    domains: [
      d(
        'lahabraschools.org',
        'eflesher@lahabraschools.org',
        'https://www.lahabraschools.org/for-parents/contact-information',
      ),
    ],
  },
  {
    lookupName: 'Loudoun County Public Schools VA',
    status: 'verified',
    domains: [
      d('lcps.org', 'carla.berman@lcps.org', 'https://www.lcps.org/o/wms'),
    ],
    note: 'loudoun.k12.va.us is legacy and was not found on current 2025-26 or 2026-27 official sources',
  },
  {
    lookupName: 'The School District of Lee County',
    status: 'verified',
    domains: [
      d(
        'leeschools.net',
        'derekjo@leeschools.net',
        'https://www.leeschools.net/common/pages/GetFile.ashx?key=crMjDq5C',
      ),
    ],
  },
  {
    lookupName: 'Muskegon Area Isd',
    status: 'verified',
    domains: [
      d('muskegonisd.org', 'bkalb@muskegonisd.org', 'https://www.muskegonisd.org/about/'),
    ],
  },
  {
    lookupName: 'Charleston County School District 01',
    status: 'verified',
    domains: [
      d(
        'charleston.k12.sc.us',
        'eric_stallings@charleston.k12.sc.us',
        'https://www.ccsdschools.com/departments/human-resources/prospective-employees/meet-the-recruitment-team',
      ),
      d(
        'charlestoncountyschools.gov',
        'communications@charlestoncountyschools.gov',
        'https://www.ccsdschools.com/about-us/administration/superintendents-cabinet',
      ),
    ],
  },
  {
    lookupName: 'San Bernardino City Unified School District',
    status: 'verified',
    domains: [
      d(
        'sbcusd.k12.ca.us',
        'cecil.wright@sbcusd.k12.ca.us',
        'https://www.sbcusd.com/departments/business-services-division/information-technology/staff-listing',
      ),
    ],
    note: 'sbcusd.com is the website domain only',
  },
  {
    lookupName: 'St. Ann Catholic School Nashville',
    status: 'verified',
    domains: [
      d('stannnash.org', 'krystal@stannnash.org', 'https://saintannparish.com/faq'),
    ],
  },
  {
    lookupName: 'St. Edward School',
    status: 'verified',
    domains: [
      d('stedward.org', 'gnordone@stedward.org', 'https://ses.stedward.org/faculty/nordone'),
    ],
  },
  {
    lookupName: 'PTACH - Jewish Instructional Support',
    status: 'verified',
    domains: [
      d('ptach.org', 'info@ptach.org', 'https://www.ptach.org/contact/'),
    ],
  },
  {
    lookupName: 'Burrel Union Elementary NH',
    status: 'verified',
    domains: [
      d('buesd.org', 'jruelas@buesd.org', 'https://burrel.k12.ca.us/District/Staff/'),
    ],
    note: 'CRM state is wrong; organization is Burrel Union Elementary in Riverdale, California',
  },
  {
    lookupName: 'Vanguard Class School East Campus',
    status: 'ambiguous',
    domains: [],
    note: 'Could be The Vanguard School in Colorado Springs (thevanguardschool.com) or Vanguard Classical East in Aurora (vanguardclassical.org)',
  },
  {
    lookupName: 'Northridge Elementary',
    status: 'ambiguous',
    domains: [],
    note: 'Could be Douglas County (dcsdk12.org) or St. Vrain Valley (svvsd.org); city or ZIP is required',
  },
];
