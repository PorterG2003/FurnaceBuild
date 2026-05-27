import { createContext, useContext, type ReactNode } from 'react';

type LeadDetailMobilePageContextValue = {
  /** Mobile drill-in: page header owns the section title. */
  suppressSectionHeader: boolean;
};

const LeadDetailMobilePageContext = createContext<LeadDetailMobilePageContextValue>({
  suppressSectionHeader: false,
});

export function LeadDetailMobilePageProvider({
  suppressSectionHeader,
  children,
}: {
  suppressSectionHeader: boolean;
  children: ReactNode;
}) {
  return (
    <LeadDetailMobilePageContext.Provider value={{ suppressSectionHeader }}>
      {children}
    </LeadDetailMobilePageContext.Provider>
  );
}

export function useLeadDetailMobilePage() {
  return useContext(LeadDetailMobilePageContext);
}
