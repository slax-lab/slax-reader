import {requireNativeModule} from 'expo';
export interface PickedPdf {uri: string; name: string; size: number}
interface PdfImportModule {pick(): Promise<PickedPdf | null>; remove(uri: string): Promise<void>}
const native = () => requireNativeModule<PdfImportModule>('SlaxPdfImport');
export const pickPdf = () => native().pick();
export const removePickedPdf = (uri: string) => native().remove(uri);
