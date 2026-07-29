const { supabase } = require('../lib/supabase');
const WorkflowRuntimeService = require('./WorkflowRuntimeService');

class WorkflowDocumentService {
    /**
     * Extracts document upload handling to protect trusted metadata.
     */
    static async uploadStepDocument({ workId, stepIdOrInstanceId, fieldKey, file, employeeContext }) {
        if (!file) throw { status: 400, message: 'No file uploaded.' };

        // 1. Strict resolution of runtime step instance
        const { stepInstanceId } = await WorkflowRuntimeService.resolveStepInstanceId(workId, stepIdOrInstanceId);

        const { data: step, error: stepErr } = await supabase
            .from('workflow_step_instances')
            .select(`
                *,
                execution:workflow_execution_instances!inner(work_id, status)
            `)
            .eq('id', stepInstanceId)
            .single();

        if (stepErr || !step) throw { status: 404, message: 'Step instance not found.' };
        if (step.execution.work_id !== workId) throw { status: 422, message: 'Step does not belong to specified Work.' };
        if (step.execution.status === 'COMPLETED' || step.execution.status === 'CANCELLED') throw { status: 422, message: 'Execution is completed or cancelled.' };
        if (step.status === 'COMPLETED') throw { status: 422, message: 'Cannot upload documents to a completed step.' };

        // 2. Load template defs for validation
        const { data: tplStep } = await supabase.from('workflow_steps').select('document_fields').eq('id', step.workflow_step_id).single();
        const normalizedDocs = WorkflowRuntimeService.normalizeFieldDefs(tplStep?.document_fields);
        
        const docFieldDef = normalizedDocs.find(f => f.key === fieldKey);
        if (!docFieldDef) throw { status: 422, message: `Field key '${fieldKey}' is not configured.` };
        
        const isFile = ['file','image','pdf'].includes(docFieldDef.type.toLowerCase());
        if (!isFile) throw { status: 422, message: `Field '${fieldKey}' is not a file field.` };

        // 3. Storage
        const fileExt = file.originalname.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const storagePath = `${workId}/${stepInstanceId}/${fieldKey}/${fileName}`;
        const bucketName = 'documents'; // or whatever it was configured to

        const { error: uploadError } = await supabase.storage
            .from(bucketName)
            .upload(storagePath, file.buffer, { contentType: file.mimetype });

        if (uploadError) {
            throw { status: 500, message: 'Failed to upload file to storage.', error: uploadError };
        }

        // 4. Update JSONB metadata
        const existingDocs = step.document_values || {};
        const mergedDocs = { ...existingDocs };
        
        // Overwrite trusted metadata exactly
        mergedDocs[fieldKey] = {
            uploaded: true,
            storageBucket: bucketName,
            storagePath: storagePath,
            uploadedAt: new Date().toISOString(),
            uploadedBy: employeeContext.employeeId,
            size: file.size,
            type: file.mimetype,
            originalName: file.originalname
        };

        const { error: updErr } = await supabase.from('workflow_step_instances').update({ document_values: mergedDocs }).eq('id', stepInstanceId);
        
        if (updErr) {
            // Cleanup storage if DB fails
            await supabase.storage.from(bucketName).remove([storagePath]);
            throw { status: 500, message: 'Failed to save document metadata.', error: updErr };
        }

        return mergedDocs[fieldKey];
    }
}

module.exports = WorkflowDocumentService;
